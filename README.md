# ToolBox Web FrontEnd

Vue 3 + TypeScript + Vite 驱动的 Web 管理端，通过 Django REST API 读写工作项目、机型模板和工具车数据。

## 前端结构

- `src/components/`：页面与可复用 Vue 组件。
- `src/composables/`：响应式业务状态和业务操作。
- `src/domain/`：领域类型、数据清洗与 API 数据转换。
- `src/services/`：表格导入导出和分享服务。
- `src/utils/`：无业务状态的通用工具。

业务代码统一使用 TypeScript；注释使用中文，并重点说明数据转换、兼容处理和不直观的业务规则。

## 本地联调

先在后端目录启动 Django：

```powershell
cd ..\ToolBoxBackEnd
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

另开一个终端启动前端：

```powershell
cd ..\ToolBoxWebFrontEnd
npm install
npm run dev
```

访问 <http://127.0.0.1:5173>。开发环境下，Vite 会把 `/api` 代理到
`VITE_DEV_PROXY_TARGET`，默认值为 <http://127.0.0.1:8000>。

## 环境配置

- `.env.development`：本地开发和 Django 代理目标。
- `.env.production`：生产构建的 API 根地址；留空表示前后端同源。
- `.env.local` / `.env.*.local`：个人覆盖配置，不提交 Git。

前端只能保存公开配置。CloudBase API Key 等服务端密钥只放在后端 `.env`。

## 构建

```powershell
npm run type-check
npm run build
npm run preview
```

生产文件输出到 `dist/`。
