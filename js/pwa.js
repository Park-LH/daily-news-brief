/**
 * js/pwa.js —— PWA 的两件事：注册 Service Worker + "安装到桌面"按钮
 *
 * 2026-10-31 新增（项目做成 APP）：
 *   1. 注册 sw.js，让浏览器把这个站当成"可安装的应用"；
 *   2. 浏览器不会随便弹安装提示（尤其 Android），所以主动捕获
 *      beforeinstallprompt，在页头亮一个「📲 安装到桌面」按钮，点了才弹；
 *   3. 已经装了（standalone 模式打开）就不显示按钮——装了再提示是废话。
 *
 * 注意：GitHub Pages 是 HTTPS，满足 PWA 的安全要求；
 * 本地 file:// 打开时什么都不做，页面照常工作。
 */
(function () {
  "use strict";

  /* ---------- 1. 注册 Service Worker ---------- */
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(err => {
        // 注册失败不影响网站本身，只打日志
        console.warn("[PWA] Service Worker 注册失败（不影响网页使用）：", err && err.message);
      });
    });
  }

  /* ---------- 2. 安装按钮 ---------- */
  let deferredPrompt = null;

  function $(id) { return document.getElementById(id); }

  function showBtn() {
    const btn = $("btnInstall");
    if (!btn) return;
    // 已经在独立窗口（装好后的 APP 形态）里打开 → 不提示
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    btn.classList.remove("hidden");
  }

  window.addEventListener("beforeinstallprompt", e => {
    // 拦下浏览器自己的横幅，改成我们自己控制什么时候弹
    e.preventDefault();
    deferredPrompt = e;
    showBtn();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    const btn = $("btnInstall");
    if (btn) btn.classList.add("hidden");
    console.log("[PWA] 应用已安装");
  });

  document.addEventListener("click", e => {
    if (!e.target.closest || !e.target.closest("#btnInstall")) return;
    const btn = $("btnInstall");
    if (!deferredPrompt) {
      // iOS Safari 不支持 beforeinstallprompt，如实提示手动添加的方法
      if (/iphone|ipad|ipod/i.test(navigator.userAgent)) {
        alert("iPhone/iPad 安装方法：\n点浏览器底部的「分享」按钮 → 选择「添加到主屏幕」");
      } else {
        alert("你的浏览器暂时不支持一键安装，可以用浏览器菜单里的「安装应用 / 添加到主屏幕」。");
      }
      return;
    }
    deferredPrompt.prompt();                       // 弹出系统安装框
    deferredPrompt.userChoice.then(() => {         // 选完不管装没装，收起按钮
      deferredPrompt = null;
      if (btn) btn.classList.add("hidden");
    });
  });
})();
