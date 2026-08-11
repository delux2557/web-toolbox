/**
 * scripts/generate_daily.js — 每日数据刷新脚本
 *
 * 功能：
 * 1. 读取 data/settings.json
 * 2. 将 lastUpdated 更新为当前时间
 * 3. 随机打乱 bookmarks 顺序（模拟每日数据刷新）
 * 4. 写回文件并输出提示
 *
 * 用法：node scripts/generate_daily.js
 *
 * 安全说明：仅修改本地文件，不自动 Git Push。
 * 如需推送，请在确认数据正确后手动执行 git add/commit/push。
 */

var fs = require('fs');
var path = require('path');

var SETTINGS_PATH = path.join(__dirname, '..', 'data', 'settings.json');

/* ---- Fisher-Yates 洗牌 ---- */
function shuffle(arr) {
  var a = arr.slice();
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var tmp = a[i];
    a[i] = a[j];
    a[j] = tmp;
  }
  return a;
}

/* ---- 格式化时间为 YYYY-MM-DD HH:mm:ss ---- */
function formatNow() {
  var d = new Date();
  var pad = function (n) { return n < 10 ? '0' + n : String(n); };
  return (
    d.getFullYear() +
    '-' + pad(d.getMonth() + 1) +
    '-' + pad(d.getDate()) +
    ' ' + pad(d.getHours()) +
    ':' + pad(d.getMinutes()) +
    ':' + pad(d.getSeconds())
  );
}

/* ---- 主流程 ---- */
try {
  // 读取
  var raw = fs.readFileSync(SETTINGS_PATH, 'utf-8');
  var settings = JSON.parse(raw);

  // 更新 lastUpdated
  var now = formatNow();
  var oldTime = settings.lastUpdated || '(未设置)';
  settings.lastUpdated = now;

  // 随机打乱书签顺序
  if (Array.isArray(settings.bookmarks) && settings.bookmarks.length > 1) {
    settings.bookmarks = shuffle(settings.bookmarks);
  }

  // 写回
  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n', 'utf-8');

  // 输出
  console.log('=== 每日数据刷新完成 ===');
  console.log('  数据文件：' + SETTINGS_PATH);
  console.log('  lastUpdated: ' + oldTime + ' → ' + now);
  console.log('  书签数量：' + (settings.bookmarks ? settings.bookmarks.length : 0) + '（已随机打乱）');
  console.log('');
  console.log('数据已刷新，请重新构建并推送 GitHub。');
} catch (err) {
  console.error('数据刷新失败：', err.message);
  process.exit(1);
}
