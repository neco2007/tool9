/**
 * メルカリ-Amazon販売支援ツール: バックグラウンド処理
 */

console.log('メルカリ-Amazon販売支援ツール: バックグラウンドスクリプト初期化');

// 拡張機能のインストール/更新時の処理
chrome.runtime.onInstalled.addListener((details) => {
  console.log('拡張機能がインストールまたは更新されました', details.reason);
  
  // 初期設定
  if (details.reason === 'install') {
    chrome.storage.local.set({
      hideNgItems: true,
      lastUpdate: new Date().toISOString()
    });
  }
});

// コンテンツスクリプトからのメッセージ処理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('バックグラウンドメッセージ受信:', message);
  
  // メッセージタイプに応じた処理
  if (message.type === 'checkConnection') {
    // 接続確認メッセージへの応答
    sendResponse({ success: true, message: '接続確認OK' });
  } else if (message.type === 'searchAmazon') {
    // Amazon検索の処理
    chrome.tabs.create({
      url: `https://www.amazon.co.jp/s?k=${encodeURIComponent(message.keyword)}`
    });
    sendResponse({ success: true });
  } else if (message.type === 'registerItem') {
    // アイテム登録処理
    console.log('商品登録リクエスト:', message.data);
    sendResponse({ success: true, message: '登録処理を開始しました' });
  }
  
  return true; // 非同期レスポンスのために必要
});

// 拡張機能アイコンクリック時の処理
chrome.action.onClicked.addListener((tab) => {
  if (tab.url.includes('mercari.com')) {
    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      function: () => {
        // 拡張機能の手動実行コード
        console.log('拡張機能アイコンがクリックされました');
        if (window.initToolManually) {
          window.initToolManually();
        } else {
          alert('メルカリ-Amazon販売支援ツール: ページが正しく初期化されていません。ページの再読み込みをお試しください。');
        }
      }
    });
  } else {
    // メルカリ以外のページの場合
    chrome.tabs.create({ url: 'https://jp.mercari.com/search' });
  }
});

// ページ読み込み完了時に拡張機能の再実行を試みる
chrome.webNavigation.onCompleted.addListener(
  function(details) {
    console.log('ページ読み込み完了:', details.url);
    
    // メルカリページの場合のみ実行
    if (details.url.includes('mercari.com')) {
      setTimeout(() => {
        chrome.scripting.executeScript({
          target: { tabId: details.tabId },
          function: () => {
            console.log('バックグラウンドからの初期化トリガー');
            if (window.initTool) {
              window.initTool();
            }
          }
        });
      }, 1500);
    }
  },
  { url: [{ hostContains: 'mercari.com' }] }
);