/**
 * メルカリ-Amazon販売支援ツール: Amazon連携機能
 * このスクリプトはAmazon検索と価格比較を担当します
 */

// Amazon機能のグローバルオブジェクト
const Amazon = (() => {
    // プライベート変数
    const _config = {
      searchDelay: 500,
      recentSearches: [],
      maxRecentSearches: 10
    };
    
    /**
     * Amazon検索を実行する
     * @param {string} searchTerm - 検索する商品名
     * @param {Object} options - 追加オプション
     */
    function searchOnAmazon(searchTerm, options = {}) {
      try {
        if (!searchTerm) {
          console.error('[Amazon] 検索キーワードが空です');
          return;
        }
        
        console.log(`[Amazon] 検索実行: ${searchTerm}`);
        
        // 検索用語をクリーニング
        const cleanedTerm = _cleanSearchTerm(searchTerm);
        
        // 検索履歴を更新
        _updateSearchHistory(cleanedTerm);
        
        // 検索URLを構築
        const searchUrl = _buildSearchUrl(cleanedTerm, options);
        
        // バックグラウンド経由で検索を実行
        try {
          chrome.runtime.sendMessage({
            type: 'searchAmazon',
            keyword: cleanedTerm
          }, response => {
            if (chrome.runtime.lastError) {
              // バックグラウンド通信に失敗した場合は直接新しいタブで開く
              window.open(searchUrl, '_blank');
            }
          });
        } catch (chromeError) {
          // バックグラウンド通信に失敗した場合は直接新しいタブで開く
          console.warn('[Amazon] バックグラウンド通信失敗:', chromeError);
          window.open(searchUrl, '_blank');
        }
      } catch (error) {
        console.error('[Amazon] 検索エラー:', error);
        // エラー発生時も最低限の機能を提供
        window.open(`https://www.amazon.co.jp/s?k=${encodeURIComponent(searchTerm)}`, '_blank');
      }
    }
    
    /**
     * 検索用語をクリーニングする
     * @private
     * @param {string} term - 元の検索用語
     * @returns {string} クリーニングされた検索用語
     */
    function _cleanSearchTerm(term) {
      if (!term) return '';
      
      // NGワードを削除
      let cleaned = Filter && Filter.removeNgWords ? Filter.removeNgWords(term) : term;
      
      // 特殊記号を削除または置換
      cleaned = cleaned
        .replace(/[【】「」『』()（）［］]/g, ' ')  // 括弧類を空白に変換
        .replace(/[^\w\s\-]/g, ' ')                // 英数字とハイフン以外の特殊文字を空白に
        .replace(/\s+/g, ' ')                      // 連続する空白を1つにまとめる
        .trim();                                   // 前後の空白を削除
      
      // 重要なキーワードのみを抽出（最適化のための処理）
      cleaned = _extractImportantKeywords(cleaned);
      
      return cleaned;
    }
    
    /**
     * 重要なキーワードを抽出する
     * @private
     * @param {string} term - 検索用語
     * @returns {string} 重要なキーワードのみの検索用語
     */
    function _extractImportantKeywords(term) {
      // 商品名から重要なキーワードを抽出するロジック
      // 例: 型番、ブランド名、カテゴリーなどを優先
      
      // この実装はシンプルな例です。
      const words = term.split(' ');
      
      // 4文字以上の単語を重要とみなす（英数字のみの場合は2文字以上）
      const importantWords = words.filter(word => {
        if (/^[a-zA-Z0-9-]+$/.test(word)) {
          return word.length >= 2; // 英数字のみの場合は2文字以上
        }
        return word.length >= 4; // それ以外は4文字以上
      });
      
      // 重要な単語がない場合は元の用語を返す
      if (importantWords.length === 0) {
        return term;
      }
      
      return importantWords.join(' ');
    }
    
    /**
     * 検索URLを構築する
     * @private
     * @param {string} term - 検索用語
     * @param {Object} options - 追加オプション
     * @returns {string} Amazon検索URL
     */
    function _buildSearchUrl(term, options = {}) {
      // 基本URL
      let url = 'https://www.amazon.co.jp/s?k=';
      
      // 検索用語を追加（URLエンコード）
      url += encodeURIComponent(term);
      
      // カテゴリーが指定されていれば追加
      if (options.category) {
        url += `&i=${encodeURIComponent(options.category)}`;
      }
      
      // ソート順が指定されていれば追加
      if (options.sort) {
        url += `&s=${encodeURIComponent(options.sort)}`;
      }
      
      return url;
    }
    
    /**
     * 検索履歴を更新する
     * @private
     * @param {string} term - 検索用語
     */
    function _updateSearchHistory(term) {
      // 既に同じ検索用語があれば削除
      const index = _config.recentSearches.indexOf(term);
      if (index !== -1) {
        _config.recentSearches.splice(index, 1);
      }
      
      // 新しい検索用語を先頭に追加
      _config.recentSearches.unshift(term);
      
      // 上限を超えた古い検索用語を削除
      if (_config.recentSearches.length > _config.maxRecentSearches) {
        _config.recentSearches.pop();
      }
    }
    
    /**
     * Amazon商品ページから価格情報を抽出する
     * @param {Document} doc - 商品ページのドキュメント
     * @returns {Object} 価格情報
     */
    function extractAmazonPrice(doc) {
      const priceData = {
        currentPrice: null,
        originalPrice: null,
        discount: null,
        currency: '¥'
      };
      
      try {
        // 通常価格
        const priceElement = doc.querySelector('#priceblock_ourprice, .a-price .a-offscreen');
        if (priceElement) {
          const priceText = priceElement.textContent.trim();
          priceData.currentPrice = _extractNumberFromPrice(priceText);
        }
        
        // 元価格（値引きがある場合）
        const originalPriceElement = doc.querySelector('.a-text-price .a-offscreen');
        if (originalPriceElement) {
          const originalPriceText = originalPriceElement.textContent.trim();
          priceData.originalPrice = _extractNumberFromPrice(originalPriceText);
          
          // 割引率の計算
          if (priceData.currentPrice && priceData.originalPrice) {
            priceData.discount = Math.round((1 - priceData.currentPrice / priceData.originalPrice) * 100);
          }
        }
      } catch (error) {
        console.error('[Amazon] 価格抽出エラー:', error);
      }
      
      return priceData;
    }
    
    /**
     * 価格文字列から数値を抽出する
     * @private
     * @param {string} priceText - 価格文字列 (例: "¥1,980")
     * @returns {number|null} 抽出された数値
     */
    function _extractNumberFromPrice(priceText) {
      if (!priceText) return null;
      
      // 数字以外の文字を削除（カンマと小数点を除く）
      const numberText = priceText.replace(/[^\d.,]/g, '').replace(/,/g, '');
      
      // 数値に変換
      const number = parseFloat(numberText);
      
      return isNaN(number) ? null : number;
    }
    
    /**
     * メルカリとAmazonの価格を比較し、利益を計算する
     * @param {number} mercariPrice - メルカリでの価格
     * @param {number} amazonPrice - Amazonでの価格
     * @returns {Object} 比較結果
     */
    function comparePrices(mercariPrice, amazonPrice) {
      if (!mercariPrice || !amazonPrice) {
        return {
          isProfitable: false,
          profit: 0,
          profitRate: 0,
          message: '価格情報が不足しています'
        };
      }
      
      // メルカリからの仕入れコスト計算（送料と手数料を考慮）
      const shippingCost = 500; // 平均的な送料
      const mercariCommission = Math.ceil(mercariPrice * 0.1); // メルカリの手数料10%
      const totalCost = mercariPrice + shippingCost;
      
      // Amazon販売時の手数料計算
      const amazonCommission = Math.ceil(amazonPrice * 0.15); // Amazonの手数料15%
      const amazonFulfillmentFee = 500; // FBA利用時の出荷取扱手数料（概算）
      
      // 最終的な利益計算
      const revenue = amazonPrice;
      const costs = totalCost + amazonCommission + amazonFulfillmentFee;
      const profit = revenue - costs;
      const profitRate = (profit / revenue) * 100;
      
      // 最低利益率の設定
      const minProfitRate = 20; // 最低20%の利益率
      
      return {
        isProfitable: profitRate >= minProfitRate,
        profit: profit,
        profitRate: Math.round(profitRate * 10) / 10, // 小数点第一位まで
        costs: {
          mercariPrice: mercariPrice,
          shippingCost: shippingCost,
          mercariCommission: mercariCommission,
          amazonCommission: amazonCommission,
          amazonFulfillmentFee: amazonFulfillmentFee,
          totalCost: costs
        },
        revenue: revenue,
        message: profitRate >= minProfitRate 
          ? `利益率 ${Math.round(profitRate)}%で販売可能です`
          : `利益率 ${Math.round(profitRate)}%は推奨利益率を下回ります`
      };
    }
    
    // 公開API
    return {
      searchOnAmazon,
      extractAmazonPrice,
      comparePrices
    };
  })();