// Spotify Mock — 服务端 patcher。
//
// 自动生成，请勿直接编辑。源文件在 src/spotify，构建：node scripts/build-server.js
//
// 客户端片段被包在 buildPatcher 的函数作用域里，每次调用都是独立闭包，
// 不会在并发请求之间共享状态。options 用客户端 $argument 的 snake_case 形式传入。

function buildPatcher($argument) {
