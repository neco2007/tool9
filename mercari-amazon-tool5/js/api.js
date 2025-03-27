/**
 * メルカリ-Amazon販売支援ツール: API通信処理
 * このスクリプトは商品管理サイトとの通信を担当します
 */

// API通信機能のグローバルオブジェクト
const Api = (() => {
    // プライベート変数
    const _config = {
      apiBaseUrl: 'https://inventory-manager-rosy-five.vercel.app',
      apiEndpoint: '/api/items',
      requestTimeout: 30000, // 30秒
      retryCount: 3,
      retryDelay: 2000, // 2秒
      debug: true
    };
    
    /**
     * 商品を出品管理サイトに登録する
     * @param {Object} itemData - 商品データ
     * @returns {Promise<Object>} 登録結果
     */
    async function registerItem(itemData) {
      try {
        _log(`商品登録開始: ${itemData.title}`);
        
        // 商品データを整形
        const formattedData = _formatItemData(itemData);
        
        // 送信前に確認ダイアログを表示
        if (!confirm(`以下の商品を出品管理サイトに登録しますか？\n\n商品名: ${formattedData.title}\n価格: ${formattedData.price}円`)) {
          _log('登録がキャンセルされました');
          return { success: false, message: 'キャンセルされました' };
        }
        
        // まずバックグラウンド経由での送信を試みる
        try {
          chrome.runtime.sendMessage({
            type: 'registerItem',
            data: formattedData
          });
        } catch (chromeError) {
          _logWarning('バックグラウンド通信エラー:', chromeError);
        }
        
        // APIリクエスト送信
        const response = await _sendApiRequest(_config.apiEndpoint, 'POST', formattedData);
        
        if (response.success) {
          _log(`商品登録成功: ${itemData.title}`);
          alert('商品を出品管理サイトに登録しました');
        } else {
          _logError(`商品登録失敗: ${response.message}`);
          alert(`登録に失敗しました: ${response.message}`);
        }
        
        return response;
      } catch (error) {
        _logError('商品登録エラー', error);
        alert('登録処理中にエラーが発生しました。再試行してください。');
        return { success: false, message: error.message };
      }
    }
    
    /**
     * 商品データを整形する
     * @private
     * @param {Object} itemData - 元の商品データ
     * @returns {Object} 整形された商品データ
     */
    function _formatItemData(itemData) {
      // 基本データの設定
      const formatted = {
        title: itemData.title || '',
        price: _extractPrice(itemData.price),
        source_url: itemData.url || window.location.href,
        platform: 'mercari',
        timestamp: new Date().toISOString()
      };
      
      // 商品ID
      if (itemData.id) {
        formatted.source_id = itemData.id;
      }
      
      // 商品説明
      if (itemData.description) {
        formatted.description = itemData.description;
      }
      
      // 商品画像
      if (itemData.imageUrl) {
        formatted.images = [itemData.imageUrl];
      } else if (itemData.images && Array.isArray(itemData.images)) {
        formatted.images = itemData.images;
      }
      
      // 出品者情報
      if (itemData.seller) {
        formatted.seller = {
          name: itemData.seller,
          id: itemData.sellerId || ''
        };
      }
      
      // 商品状態
      if (itemData.condition) {
        formatted.condition = itemData.condition;
      }
      
      return formatted;
    }
    
    /**
     * 価格文字列から数値を抽出する
     * @private
     * @param {string} priceText - 価格文字列 (例: "¥1,980")
     * @returns {number|null} 抽出された数値
     */
    function _extractPrice(priceText) {
      if (!priceText) return null;
      
      // 数字以外の文字を削除（カンマと小数点を除く）
      const numberText = priceText.replace(/[^\d.,]/g, '').replace(/,/g, '');
      
      // 数値に変換
      const number = parseFloat(numberText);
      
      return isNaN(number) ? null : number;
    }
    
    /**
     * APIリクエストを送信する
     * @private
     * @param {string} endpoint - APIエンドポイントパス
     * @param {string} method - HTTPメソッド ('GET', 'POST', 'PUT', 'DELETE')
     * @param {Object} data - 送信データ
     * @returns {Promise<Object>} レスポンス
     */
    async function _sendApiRequest(endpoint, method, data) {
      let retryCount = 0;
      
      while (retryCount <= _config.retryCount) {
        try {
          const fullUrl = `${_config.apiBaseUrl}${endpoint}`;
          
          _log(`APIリクエスト: ${method} ${fullUrl}`);
          
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), _config.requestTimeout);
          
          const response = await fetch(fullUrl, {
            method: method,
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: data ? JSON.stringify(data) : undefined,
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          // JSONレスポンスを解析
          let responseData;
          try {
            responseData = await response.json();
          } catch (jsonError) {
            // JSONとして解析できない場合はテキストとして解析
            const textData = await response.text();
            responseData = { message: textData };
          }
          
          if (!response.ok) {
            throw new Error(responseData.message || `HTTPエラー: ${response.status}`);
          }
          
          return {
            success: true,
            ...responseData
          };
        } catch (error) {
          retryCount++;
          
          // 最大再試行回数に達した場合はエラーを投げる
          if (retryCount > _config.retryCount) {
            _logError(`APIリクエスト失敗 (${retryCount}/${_config.retryCount + 1}回目): ${error.message}`);
            throw error;
          }
          
          // 再試行前に待機
          _logError(`APIリクエスト失敗、再試行 (${retryCount}/${_config.retryCount + 1}回目): ${error.message}`);
          await new Promise(resolve => setTimeout(resolve, _config.retryDelay));
        }
      }
    }
    
    /**
     * ログを出力する
     * @private
     * @param {string} message - ログメッセージ
     */
    function _log(message) {
      if (_config.debug) {
        console.log(`[API] ${message}`);
      }
    }
    
    /**
     * 警告ログを出力する
     * @private
     * @param {string} message - 警告メッセージ
     * @param {Error} [error] - エラーオブジェクト
     */
    function _logWarning(message, error) {
      console.warn(`[API] ${message}`, error || '');
    }
    
    /**
     * エラーログを出力する
     * @private
     * @param {string} message - エラーメッセージ
     * @param {Error} [error] - エラーオブジェクト
     */
    function _logError(message, error) {
      console.error(`[API] ${message}`, error || '');
    }
    
    // 公開API
    return {
      registerItem
    };
  })();