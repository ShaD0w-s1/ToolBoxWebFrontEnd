import { createApp } from "vue";
import App from "./App.vue";
import "./styles/main.css";

// Vue 应用只在这里完成装配，业务初始化由 App.vue 负责。
createApp(App).mount("#app");
