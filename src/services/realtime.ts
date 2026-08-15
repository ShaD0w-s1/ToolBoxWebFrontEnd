// CloudBase 实时数据推送（watch）封装。
//
// 用途：监听 work_change_log 计数器文档（_id="revision"）的 seq 变化，
// 作为「变更信号」触发前端增量合并，替代/加速定时轮询。
//
// 注意：
// - publishableKey 是「匿名用户」公开 key（scope=anonymous），非密钥，可硬编码。
// - 业务数据仍走 Django REST（乐观锁/字段合并不变）；这里只读信号集合。
// - watch 失败/超限时由调用方回退到定时轮询。
import cloudbase from "@cloudbase/js-sdk";

const ENV_ID = "da-tool-list-d2g0awsejc0658949";
const REGION = "ap-shanghai";
const PUBLISHABLE_KEY =
  "eyJhbGciOiJSUzI1NiIsImtpZCI6IjlkMWRjMzFlLWI0ZDAtNDQ4Yi1hNzZmLWIwY2M2M2Q4MTQ5OCJ9.eyJpc3MiOiJodHRwczovL2RhLXRvb2wtbGlzdC1kMmcwYXdzZWpjMDY1ODk0OS5hcC1zaGFuZ2hhaS50Y2ItYXBpLnRlbmNlbnRjbG91ZGFwaS5jb20iLCJzdWIiOiJhbm9uIiwiYXVkIjoiZGEtdG9vbC1saXN0LWQyZzBhd3NlamMwNjU4OTQ5IiwiZXhwIjo0MDg5NjgwNDUwLCJpYXQiOjE3ODU5OTcyNTAsIm5vbmNlIjoiSWxJcEtWWWNUX21rcUpKR2hSbXdjQSIsImF0X2hhc2giOiJJbElwS1ZZY1RfbWtxSkpHaFJtd2NBIiwibmFtZSI6IkFub255bW91cyIsInNjb3BlIjoiYW5vbnltb3VzIiwicHJvamVjdF9pZCI6ImRhLXRvb2wtbGlzdC1kMmcwYXdzZWpjMDY1ODk0OSIsIm1ldGEiOnsicGxhdGZvcm0iOiJQdWJsaXNoYWJsZUtleSJ9LCJ1c2VyX3R5cGUiOiIiLCJjbGllbnRfdHlwZSI6ImNsaWVudF91c2VyIiwiaXNfc3lzdGVtX2FkbWluIjpmYWxzZX0.ixFJSHcsNyHrrOCaalSDLga4nBpQDfmUfrnEeumMurHDl3k3fD3e4HszBFq3Ra114pis_Hq9V5SEW1WVX_19rSUz-fgOlKLexyrLXmQEe6ne2VWu_bRTlOT6E5-NI3W8CFeABQnN1y0W1ltJ7vQ9hmg4d1hx76lEhb-YGuJ6vM4Ywz2STUfdxk-pw9P6qCsypB30OqhMI26cQFmx7Cj17SB3MDurhGn3H6_gRFG-jGOV9pdYAKCRuk66QoBUxTD7dsQC58M2Hg720xtOe6FCXINBkxJ8fUWbB3v7Pt7axTMWCHZMWpoZhRNkGLQsqMfAdQmlzK8kcK-T6jDLwQTj7g";

type CloudBaseApp = ReturnType<typeof cloudbase.init>;
type Watcher = { close: () => void };

let app: CloudBaseApp | null = null;
let initPromise: Promise<CloudBaseApp> | null = null;
let watcher: Watcher | null = null;

function getApp(): Promise<CloudBaseApp> {
  if (app) return Promise.resolve(app);
  if (!initPromise) {
    initPromise = (async () => {
      app = cloudbase.init({
        env: ENV_ID,
        region: REGION,
        accessKey: PUBLISHABLE_KEY,
        auth: { detectSessionInUrl: true },
      });
      return app;
    })();
  }
  return initPromise;
}

/** 开始监听 revision 计数器文档；seq 变化时回调 onChange(seq)。 */
export async function startWatchRevision(
  onChange: (seq: string) => void,
  onError: (err: unknown) => void,
): Promise<void> {
  try {
    const appInstance = await getApp();
    const auth = (appInstance as any).auth();
    const { error } = await auth.signInAnonymously();
    if (error) {
      onError(error);
      return;
    }
    const db = (appInstance as any).database();
    // 集合仅含 1 个 revision 计数器文档，直接 watch 整个集合（避免 _id 字段 where 的边缘问题）。
    watcher = db
      .collection("work_preparation_work_change_log")
      .watch({
        onChange: (snapshot: { docs?: Array<{ _id?: string; seq?: number }> }) => {
          const docs = Array.isArray(snapshot?.docs) ? snapshot.docs : [];
          const doc = docs.find((d) => d?._id === "revision") || docs[0];
          if (doc && doc.seq != null) onChange(String(doc.seq));
        },
        onError: (err: unknown) => {
          watcher = null;
          onError(err);
        },
      }) as Watcher;
  } catch (err) {
    onError(err);
  }
}

/** 关闭 watch 监听。 */
export function stopWatchRevision(): void {
  if (watcher) {
    try {
      watcher.close();
    } catch {
      /* ignore */
    }
    watcher = null;
  }
}
