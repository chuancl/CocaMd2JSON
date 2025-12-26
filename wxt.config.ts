import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {
    name: "Vocabulary JSON Generator",
    description: "Parse markdown vocabulary lists and fetch details from Youdao",
    version: "1.0.0",
    permissions: [
      "downloads",
      "tabs"
    ],
    host_permissions: [
      "*://dict.youdao.com/*"
    ],
    action: {} 
  },
  modules: ['@wxt-dev/module-react'],
});