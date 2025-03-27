/**
 * メルカリ-Amazon販売支援ツール: メインコンテンツスクリプト
 * このスクリプトはメルカリページの分析とDOM操作を担当します
 */

// グローバル設定と状態変数
let config = {
    initialized: false,
    isProcessing: false,
    debug: true,
    currentSite: null,
    version: '1.0.1'
  };
  
  // ツール初期化 (グローバルに公開)
  window.initToolManually = function() {
    console.log('ユーザーによる手動実行');
    if (config.initialized) {
      reprocessCurrentPage();
    } else {
      initTool();
    }
  };
  
  // ツール初期化をグローバルに公開
  window.initTool = initTool;
  
  // ツール初期化
  async function initTool() {
    if (config.initialized) return;
    
    try {
      log(`メルカリ-Amazon販売支援ツール v${config.version} を初期化中...`);
      
      // バックグラウンドスクリプトとの接続を確認
      try {
        const connectionResult = await checkBackgroundConnection();
        if (!connectionResult) {
          logWarning('バックグラウンドスクリプトとの接続が確立できませんでした。一部の機能が制限される可能性があります。');
        }
      } catch (connErr) {
        logWarning('バックグラウンド接続エラー:', connErr);
      }
      
      // 現在のサイトを検出
      config.currentSite = detectCurrentSite();
      log(`検出されたサイト: ${config.currentSite || '不明'}`);
      
      // フィルター初期化
      await Filter.initialize();
      
      // サイトに応じた処理を実行
      if (config.currentSite === 'mercari-search') {
        await processMercariSearchPage();
        setupMutationObserver();
      } else if (config.currentSite === 'mercari-item') {
        await processMercariItemPage();
      } else if (config.currentSite === 'amazon-search') {
        // Amazonの検索結果ページ処理は今後実装
        log('Amazon検索ページを検出しました（機能は現在開発中）');
      } else {
        logWarning('サポートされていないページタイプです');
      }
      
      config.initialized = true;
      log('初期化完了');
      
      // 完了を通知
      showToast('メルカリ-Amazon販売支援ツールが初期化されました');
    } catch (error) {
      logError('初期化エラー', error);
      showToast('初期化中にエラーが発生しました', 'error');
    }
  }
  
  // バックグラウンド接続を確認
  async function checkBackgroundConnection() {
    try {
      const response = await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('バックグラウンド接続タイムアウト'));
        }, 3000);
        
        try {
          chrome.runtime.sendMessage({
            type: 'checkConnection',
            timestamp: Date.now()
          }, response => {
            clearTimeout(timeoutId);
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        } catch (err) {
          clearTimeout(timeoutId);
          reject(err);
        }
      });
      
      log('バックグラウンド接続確認結果:', response);
      return response && response.success;
    } catch (error) {
      logError('バックグラウンド接続確認エラー:', error);
      return false;
    }
  }
  
  // 現在のページを再処理
  function reprocessCurrentPage() {
    log('ページの再処理を開始します');
    if (config.currentSite === 'mercari-search') {
      processMercariSearchPage();
    } else if (config.currentSite === 'mercari-item') {
      processMercariItemPage();
    }
  }
  
  // 現在のサイトを検出
  function detectCurrentSite() {
    const url = window.location.href;
    
    if (url.includes('jp.mercari.com/search') || url.includes('jp.mercari.com/category')) {
      return 'mercari-search';
    } else if (url.includes('jp.mercari.com/item/')) {
      return 'mercari-item';
    } else if (url.includes('amazon.co.jp/s')) {
      return 'amazon-search';
    } else if (url.includes('amazon.co.jp/dp/') || url.includes('amazon.co.jp/gp/product/')) {
      return 'amazon-item';
    }
    
    return null;
  }
  
  // メルカリ検索ページの処理
  async function processMercariSearchPage() {
    log('メルカリ検索ページを処理中...');
    
    // コントロールパネルを追加
    addControlPanel();
    
    // アイテムリストを取得して処理
    const itemElements = findMercariItems();
    log(`${itemElements.length}個の商品アイテムを処理します`);
    
    // 各アイテムを処理
    let processedCount = 0;
    let hiddenCount = 0;
    
    for (const item of itemElements) {
      try {
        const result = await processItemElement(item);
        processedCount++;
        if (result && result.hidden) {
          hiddenCount++;
        }
      } catch (error) {
        logError('アイテム処理エラー', error);
      }
    }
    
    log(`処理完了: ${processedCount}個処理、${hiddenCount}個のNGアイテムを非表示`);
    
    // 処理結果を通知
    if (processedCount > 0) {
      showToast(`${processedCount}個のアイテムを処理しました（${hiddenCount}個のNGアイテムを非表示）`);
    }
  }
  
  // メルカリの商品要素を検出する強化版関数
  function findMercariItems() {
    // 試すセレクタの優先順位リスト
    const selectors = [
      '[data-testid="item-cell"]',
      'mer-item-thumbnail',
      '.merItemThumbnail',
      '.items-box',
      '.item-cell',
      '.merItemList > div'
    ];
    
    // いずれかのセレクタで要素を見つける
    for (const selector of selectors) {
      const items = document.querySelectorAll(selector);
      if (items && items.length > 0) {
        log(`${selector} で ${items.length}個のアイテムを検出`);
        return Array.from(items);
      }
    }
    
    // 最終手段：画像を含む商品カードらしき要素を探す
    log('汎用的な方法でアイテム検出を試みます');
    const imgContainers = Array.from(document.querySelectorAll('div'));
    const potentialItems = imgContainers.filter(div => {
      // 商品カードらしき要素を選別
      const hasImg = div.querySelector('img') !== null;
      const hasTitle = div.textContent && div.textContent.length > 10;
      const hasPrice = div.textContent && div.textContent.includes('¥');
      const hasGoodSize = div.clientWidth > 150 && div.clientHeight > 150;
      
      return hasImg && hasPrice && hasGoodSize;
    });
    
    log(`汎用的な方法で ${potentialItems.length}個のアイテム候補を検出`);
    return potentialItems;
  }
  
  // メルカリ商品詳細ページの処理
  async function processMercariItemPage() {
    log('メルカリ商品詳細ページを処理中...');
    
    // 商品情報を取得
    const productData = extractProductData();
    log('商品データ抽出:', productData);
    
    // NGワードチェック
    if (productData.title && Filter.containsNgWord(productData.title)) {
      log(`NGワードを検出: ${productData.title}`);
      const ngWords = Filter.findNgWords(productData.title);
      log(`検出されたNGワード: ${ngWords.join(', ')}`);
      addNgWarning(productData.title, ngWords);
    } else {
      // コントロールパネルを追加
      addItemPageControls(productData);
    }
    
    // 出品者チェック
    if (productData.sellerId && Filter.isNgSeller(productData.sellerId)) {
      log(`NG出品者を検出: ${productData.seller} (ID: ${productData.sellerId})`);
      addSellerWarning(productData.seller);
    }
  }
  
  // 商品アイテム要素の処理
  async function processItemElement(itemElement) {
    // 既に処理済みかチェック
    if (itemElement.classList.contains('ma-tool-processed')) {
      return null;
    }
    
    try {
      // 商品情報を抽出
      const itemData = extractItemData(itemElement);
      
      // タイトルが取得できなかった場合はスキップ
      if (!itemData.title) {
        itemElement.classList.add('ma-tool-processed');
        return null;
      }
      
      // NGワードチェック
      let isNgItem = false;
      if (itemData.title && Filter.containsNgWord(itemData.title)) {
        isNgItem = true;
        itemElement.classList.add('ma-tool-ng');
        
        if (Filter.shouldHideNgItems()) {
          itemElement.classList.add('ma-tool-hidden');
        }
      }
      
      // ボタンを追加
      addButtonsToItem(itemElement, itemData);
      
      // 処理済みとしてマーク
      itemElement.classList.add('ma-tool-processed');
      
      return {
        processed: true,
        hidden: isNgItem && Filter.shouldHideNgItems(),
        data: itemData
      };
    } catch (error) {
      logError('アイテム処理エラー', error);
      return null;
    }
  }
  
  // 商品情報の抽出（検索結果リストの各アイテム用）
  function extractItemData(itemElement) {
    const data = {
      title: '',
      price: '',
      url: '',
      imageUrl: '',
      id: ''
    };
    
    try {
      // 商品名 - 複数のセレクタを試行
      const titleSelectors = [
        '[data-testid="thumbnail-item-name"]',
        '.merItemThumbnail h3',
        '.merItemList h3',
        '.items-box h3',
        '.item-name'
      ];
      
      for (const selector of titleSelectors) {
        const titleEl = itemElement.querySelector(selector);
        if (titleEl) {
          data.title = titleEl.textContent.trim();
          break;
        }
      }
      
      // 商品名がまだ見つからない場合は、任意のテキスト要素から推測
      if (!data.title) {
        // h3, h4, pタグなどからテキストを抽出
        const textElements = itemElement.querySelectorAll('h3, h4, p, div');
        for (const el of textElements) {
          const text = el.textContent.trim();
          if (text && text.length > 5 && !text.includes('¥')) {
            data.title = text;
            break;
          }
        }
      }
      
      // 価格 - 複数のセレクタを試行
      const priceSelectors = [
        '[data-testid="thumbnail-item-price"]',
        '.merItemThumbnail span',
        '.item-price',
        '.price'
      ];
      
      for (const selector of priceSelectors) {
        const priceEl = itemElement.querySelector(selector);
        if (priceEl && priceEl.textContent.includes('¥')) {
          data.price = priceEl.textContent.trim();
          break;
        }
      }
      
      // 価格がまだ見つからない場合は、¥記号を含むテキストを探す
      if (!data.price) {
        // すべてのテキストから価格を探す
        const allText = itemElement.textContent;
        const priceMatch = allText.match(/¥[,\d]+/);
        if (priceMatch) {
          data.price = priceMatch[0];
        }
      }
      
      // URL
      const linkElement = itemElement.querySelector('a');
      if (linkElement) {
        data.url = linkElement.href;
        // 商品IDを抽出
        const match = data.url.match(/\/item\/([a-zA-Z0-9]+)/);
        if (match && match[1]) {
          data.id = match[1];
        }
      }
      
      // 画像URL
      const imgElement = itemElement.querySelector('img');
      if (imgElement) {
        data.imageUrl = imgElement.src;
      }
    } catch (error) {
      logError('データ抽出エラー', error);
    }
    
    return data;
  }
  
  // 商品ページからの商品情報抽出
  function extractProductData() {
    const data = {
      title: '',
      price: '',
      description: '',
      condition: '',
      seller: '',
      sellerId: '',
      images: [],
      id: ''
    };
    
    try {
      // URL から商品ID取得
      const match = window.location.href.match(/\/item\/([a-zA-Z0-9]+)/);
      if (match && match[1]) {
        data.id = match[1];
      }
      
      // 商品名 - 複数のセレクタを試行
      const titleSelectors = [
        '.merHeading h1',
        '#item-info h1',
        'h1.item-name'
      ];
      
      for (const selector of titleSelectors) {
        const titleEl = document.querySelector(selector);
        if (titleEl) {
          data.title = titleEl.textContent.trim();
          break;
        }
      }
      
      // 価格 - 複数のセレクタを試行
      const priceSelectors = [
        '[data-testid="price"]',
        '.item-price',
        '.price'
      ];
      
      for (const selector of priceSelectors) {
        const priceEl = document.querySelector(selector);
        if (priceEl) {
          data.price = priceEl.textContent.trim();
          break;
        }
      }
      
      // 説明文 - 複数のセレクタを試行
      const descSelectors = [
        '[data-testid="description"]',
        '.item-description',
        '.description'
      ];
      
      for (const selector of descSelectors) {
        const descEl = document.querySelector(selector);
        if (descEl) {
          data.description = descEl.textContent.trim();
          break;
        }
      }
      
      // 商品状態 - 複数のセレクタを試行
      const conditionSelectors = [
        '#item-info span[data-testid="商品の状態"]',
        '.item-condition'
      ];
      
      for (const selector of conditionSelectors) {
        const condEl = document.querySelector(selector);
        if (condEl) {
          data.condition = condEl.textContent.trim();
          break;
        }
      }
      
      // 出品者 - 複数のセレクタを試行
      const sellerSelectors = [
        '.merUserObject p',
        '.seller-name'
      ];
      
      for (const selector of sellerSelectors) {
        const sellerEl = document.querySelector(selector);
        if (sellerEl) {
          data.seller = sellerEl.textContent.trim();
          break;
        }
      }
      
      // 出品者ID - 複数のセレクタを試行
      const sellerLinkSelectors = [
        'a[data-location="item_details:seller_info"]',
        'a[href*="/user/"]'
      ];
      
      for (const selector of sellerLinkSelectors) {
        const sellerLinkEl = document.querySelector(selector);
        if (sellerLinkEl && sellerLinkEl.href) {
          const sellerMatch = sellerLinkEl.href.match(/\/user\/([a-zA-Z0-9]+)/);
          if (sellerMatch && sellerMatch[1]) {
            data.sellerId = sellerMatch[1];
            break;
          }
        }
      }
      
      // 画像 - 複数のセレクタを試行
      const imageSelectors = [
        '.slick-list .slick-slide img',
        '.item-photos img'
      ];
      
      for (const selector of imageSelectors) {
        const imageEls = document.querySelectorAll(selector);
        if (imageEls && imageEls.length > 0) {
          data.images = Array.from(imageEls).map(img => img.src);
          break;
        }
      }
    } catch (error) {
      logError('商品データ抽出エラー', error);
    }
    
    return data;
  }
  
  // コントロールパネルの追加（検索ページ用）
  function addControlPanel() {
    // 既にパネルがあれば追加しない
    if (document.querySelector('.ma-tool-controls')) return;
    
    const controlPanel = document.createElement('div');
    controlPanel.className = 'ma-tool-controls';
    controlPanel.style.cssText = 'display: flex; justify-content: center; padding: 10px; background: #f8f9fa; border-bottom: 1px solid #ddd; position: fixed; top: 100px; left: 20%; right: 20%; z-index: 9999; box-shadow: 0 2px 4px rgba(0,0,0,0.1); border-radius: 8px;';
    
    // NGワードフィルタートグルボタン
    const filterToggle = document.createElement('button');
    filterToggle.textContent = Filter.shouldHideNgItems() ? 'NGワード非表示中' : 'NGワード表示中';
    filterToggle.style.cssText = 'margin: 0 5px; padding: 8px 16px; background: #6c757d; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
    filterToggle.onclick = () => {
      const isShowing = Filter.toggleNgItems();
      filterToggle.textContent = isShowing ? 'NGワード表示中' : 'NGワード非表示中';
    };
    
    controlPanel.appendChild(filterToggle);
    
    // 再スキャンボタン
    const scanButton = document.createElement('button');
    scanButton.textContent = '再スキャン';
    scanButton.style.cssText = 'margin: 0 5px; padding: 8px 16px; background: #28a745; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold;';
    scanButton.onclick = () => processMercariSearchPage();
    
    controlPanel.appendChild(scanButton);
    
    // DOMに追加
    document.body.appendChild(controlPanel);
    
    log('コントロールパネルを追加しました');
  }
  
  // 商品詳細ページ用コントロールの追加
  function addItemPageControls(productData) {
    // 既存のコントロールを削除
    const existingControls = document.querySelector('.ma-tool-item-controls');
    if (existingControls) {
      existingControls.remove();
    }
    
    const controlPanel = document.createElement('div');
    controlPanel.className = 'ma-tool-item-controls';
    controlPanel.style.cssText = 'display: flex; padding: 15px; background: #f8f9fa; border-radius: 8px; margin: 10px 0; border: 1px solid #ddd;';
    
    // Amazon検索ボタン
    const amazonButton = document.createElement('button');
    amazonButton.textContent = 'Amazon検索';
    amazonButton.style.cssText = 'margin: 0 5px; padding: 10px 20px; background: #ff9900; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;';
    amazonButton.onclick = () => {
      Amazon.searchOnAmazon(productData.title);
    };
    
    controlPanel.appendChild(amazonButton);
    
    // 出品ツール登録ボタン
    const registerButton = document.createElement('button');
    registerButton.textContent = '出品ツールに登録';
    registerButton.style.cssText = 'margin: 0 5px; padding: 10px 20px; background: #0066c0; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px;';
    registerButton.onclick = () => {
      Api.registerItem(productData);
    };
    
    controlPanel.appendChild(registerButton);
    
    // パネルをページに追加
    const insertLocations = [
      document.querySelector('#item-info'),
      document.querySelector('.item-info'),
      document.querySelector('main')
    ];
    
    let inserted = false;
    for (const location of insertLocations) {
      if (location) {
        location.prepend(controlPanel);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      document.body.prepend(controlPanel);
    }
    
    log('商品詳細ページコントロールを追加しました');
  }
  
  // 商品アイテムにボタンを追加
  function addButtonsToItem(itemElement, itemData) {
    // 既にボタンがある場合は追加しない
    if (itemElement.querySelector('.ma-tool-item-buttons')) return;
    
    try {
      // 商品カードのレイアウトを相対位置に設定
      itemElement.style.position = 'relative';
      
      const buttonContainer = document.createElement('div');
      buttonContainer.className = 'ma-tool-item-buttons';
      buttonContainer.style.cssText = 'position: absolute; bottom: 0; left: 0; right: 0; display: flex; justify-content: center; padding: 5px; background: rgba(255,255,255,0.9); z-index: 100; border-top: 1px solid #eee;';
      
      // Amazon検索ボタン
      const amazonButton = document.createElement('button');
      amazonButton.textContent = 'Amazon';
      amazonButton.style.cssText = 'margin: 0 3px; padding: 4px 8px; background: #ff9900; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: bold;';
      amazonButton.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        Amazon.searchOnAmazon(itemData.title);
        return false;
      };
      
      buttonContainer.appendChild(amazonButton);
      
      // 出品登録ボタン
      const registerButton = document.createElement('button');
      registerButton.textContent = '登録';
      registerButton.style.cssText = 'margin: 0 3px; padding: 4px 8px; background: #0066c0; color: white; border: none; border-radius: 4px; font-size: 12px; cursor: pointer; font-weight: bold;';
      registerButton.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        Api.registerItem(itemData);
        return false;
      };
      
      buttonContainer.appendChild(registerButton);
      
      // ボタンコンテナを商品アイテムに追加
      itemElement.appendChild(buttonContainer);
    } catch (error) {
      logError('ボタン追加エラー', error);
    }
  }
  
  // NGワード警告の追加
  function addNgWarning(title, ngWords = []) {
    const warning = document.createElement('div');
    warning.className = 'ma-tool-ng-warning';
    warning.style.cssText = 'background-color: #fff3cd; color: #856404; padding: 12px; margin: 10px 0; border-radius: 4px; border-left: 4px solid #ffc107; font-weight: bold;';
    
    let warningText = `⚠️ この商品のタイトルにNGワードが含まれています: ${title}`;
    if (ngWords && ngWords.length > 0) {
      warningText += `<br><small>検出されたNGワード: ${ngWords.join(', ')}</small>`;
    }
    
    warning.innerHTML = warningText;
    
    const insertLocations = [
      document.querySelector('#item-info'),
      document.querySelector('.item-info'),
      document.querySelector('main')
    ];
    
    let inserted = false;
    for (const location of insertLocations) {
      if (location) {
        location.prepend(warning);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      document.body.prepend(warning);
    }
  }
  
  // NG出品者警告の追加
  function addSellerWarning(sellerName) {
    const warning = document.createElement('div');
    warning.className = 'ma-tool-ng-warning ma-tool-seller-warning';
    warning.style.cssText = 'background-color: #f8d7da; color: #721c24; padding: 12px; margin: 10px 0; border-radius: 4px; border-left: 4px solid #dc3545; font-weight: bold;';
    warning.textContent = `⚠️ この出品者はNGリストに登録されています: ${sellerName}`;
    
    const insertLocations = [
      document.querySelector('#item-info'),
      document.querySelector('.item-info'),
      document.querySelector('main')
    ];
    
    let inserted = false;
    for (const location of insertLocations) {
      if (location) {
        location.prepend(warning);
        inserted = true;
        break;
      }
    }
    
    if (!inserted) {
      document.body.prepend(warning);
    }
  }
  
  // DOM変更監視の設定
  function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
      // 対象の変更かどうかを確認
      let shouldProcess = false;
      
      // 商品リストに要素が追加されたかをチェック
      const itemContainers = [
        document.querySelector('[data-testid="search-items"]'),
        document.querySelector('.mer-list'),
        document.querySelector('.items-box-content')
      ];
      
      for (const container of itemContainers) {
        if (container) {
          for (const mutation of mutations) {
            if (container.contains(mutation.target) || mutation.target === container) {
              shouldProcess = true;
              break;
            }
          }
          if (shouldProcess) break;
        }
      }
      
      // 新しいアイテムを処理
      if (shouldProcess && !config.isProcessing) {
        config.isProcessing = true;
        setTimeout(async () => {
          const allItems = findMercariItems();
          const unprocessedItems = Array.from(allItems).filter(item => !item.classList.contains('ma-tool-processed'));
          
          if (unprocessedItems.length > 0) {
            log(`新しく${unprocessedItems.length}個のアイテムを検出`);
            
            for (const item of unprocessedItems) {
              await processItemElement(item);
            }
          }
          
          config.isProcessing = false;
        }, 500);
      }
    });
    
    // 監視開始
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    
    log('DOM変更の監視を開始しました');
  }
  
  // トースト通知を表示
  function showToast(message, type = 'info') {
    // 既存のトーストを削除
    const existingToast = document.querySelector('.ma-tool-toast');
    if (existingToast) {
      existingToast.remove();
    }
    
    // トースト要素を作成
    const toast = document.createElement('div');
    toast.className = `ma-tool-toast ma-tool-toast-${type}`;
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 10px 20px;
      background-color: ${type === 'error' ? 'rgba(220, 53, 69, 0.9)' : 'rgba(0, 0, 0, 0.8)'};
      color: white;
      border-radius: 4px;
      z-index: 10000;
      font-size: 14px;
      max-width: 300px;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.2);
      opacity: 0;
      transform: translateY(-20px);
      transition: opacity 0.3s, transform 0.3s;
    `;
    toast.textContent = message;
    
    // ページに追加
    document.body.appendChild(toast);
    
    // 表示アニメーション
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    }, 10);
    
    // 自動的に消す
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
      setTimeout(() => {
        toast.remove();
      }, 300);
    }, 3000);
  }
  
  // ロギング関数
  function log(message, data) {
    if (config.debug) {
      if (data) {
        console.log(`[メルカリ-Amazon販売支援ツール] ${message}`, data);
      } else {
        console.log(`[メルカリ-Amazon販売支援ツール] ${message}`);
      }
    }
  }
  
  // 警告ログ関数
  function logWarning(message, data) {
    if (data) {
      console.warn(`[メルカリ-Amazon販売支援ツール 警告] ${message}`, data);
    } else {
      console.warn(`[メルカリ-Amazon販売支援ツール 警告] ${message}`);
    }
  }
  
  // エラーログ関数
  function logError(message, error) {
    console.error(`[メルカリ-Amazon販売支援ツール エラー] ${message}:`, error);
  }
  
  // 複数の初期化トリガーを設定
  // DOMが読み込まれたときに実行
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initTool);
  } else {
    // DOMがすでに読み込まれている場合は直接実行
    setTimeout(initTool, 100);
  }
  
  // ページが完全に読み込まれたときにも実行
  window.addEventListener('load', () => {
    setTimeout(initTool, 500);
  });