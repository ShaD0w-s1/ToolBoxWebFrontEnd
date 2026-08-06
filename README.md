# ToolBox 前端

Vite 驱动的本地前端，通过 Django REST API 读写工作项目、机型模板和工具车数据。

## 本地联调

先在后端目录启动 Django：

```powershell
cd ..\ToolBoxBackEnd
.\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000
```

另开一个终端启动前端：

```powershell
cd ..\ToolBoxFrontEnd
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
npm run build
npm run preview
```

生产文件输出到 `dist/`。
