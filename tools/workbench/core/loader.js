/**
 * core/loader.js — 核心加载引擎
 *
 * 职责：
 * 1. 获取 manifest.json 确定活跃版本
 * 2. 动态加载对应版本的 index.html 到 #app 容器
 * 3. 将插件列表挂载到 window.__PLUGINS__ 全局变量
 *
 * 红线：禁止修改本文件以外的任何文件来实现"切换版本"功能。
 */

(function () {
  'use strict';

  const APP_CONTAINER_ID = 'app';

  /**
   * 获取 manifest 并启动应用
   */
  async function bootstrap() {
    const container = document.getElementById(APP_CONTAINER_ID);
    if (!container) {
      console.error('[Loader] 未找到 #%s 容器，加载中止', APP_CONTAINER_ID);
      return;
    }

    try {
      const manifest = await fetchManifest();
      mountPlugins(manifest.plugins);
      await loadVersion(manifest.activeVersion, container);
    } catch (err) {
      console.error('[Loader] 启动失败:', err);
      container.innerHTML =
        '<p style="padding:2rem;color:#c44;">工作台加载失败，请刷新页面重试。</p>';
    }
  }

  /**
   * 获取 manifest.json
   * @returns {Promise<{activeVersion: string, plugins: Array}>}
   */
  async function fetchManifest() {
    const resp = await fetch('manifest.json');
    if (!resp.ok) {
      throw new Error('manifest.json 请求失败，状态码 ' + resp.status);
    }
    return resp.json();
  }

  /**
   * 将插件列表挂载到全局变量
   * @param {Array} plugins
   */
  function mountPlugins(plugins) {
    window.__PLUGINS__ = Array.isArray(plugins) ? plugins : [];
    console.log('[Loader] 已挂载 %d 个插件到 window.__PLUGINS__', window.__PLUGINS__.length);
  }

  /**
   * 根据 activeVersion 动态加载对应版本的 index.html
   * @param {string} version - 版本标识，如 "v1"
   * @param {HTMLElement} container - #app 容器
   */
  async function loadVersion(version, container) {
    const versionPath = version + '/index.html';

    try {
      const resp = await fetch(versionPath);
      if (!resp.ok) {
        throw new Error('版本 ' + version + ' 加载失败，状态码 ' + resp.status);
      }

      const html = await resp.text();
      container.innerHTML = html;

      // 动态执行版本页面中的内联脚本
      executeInlineScripts(container);

      console.log('[Loader] 版本 %s 已加载', version);
    } catch (err) {
      console.error('[Loader] 版本加载异常:', err);
      container.innerHTML =
        '<p style="padding:2rem;color:#c44;">版本 ' +
        version +
        ' 不可用，请联系管理员。</p>';
    }
  }

  /**
   * 执行容器内的 <script> 标签（支持 src 和 inline）
   * @param {HTMLElement} container
   */
  function executeInlineScripts(container) {
    const scripts = container.querySelectorAll('script');
    scripts.forEach(function (oldScript) {
      var newScript = document.createElement('script');
      var attrs = oldScript.attributes;
      for (var i = 0; i < attrs.length; i++) {
        newScript.setAttribute(attrs[i].name, attrs[i].value);
      }
      newScript.textContent = oldScript.textContent;
      oldScript.parentNode.replaceChild(newScript, oldScript);
    });
  }

  // 启动
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
