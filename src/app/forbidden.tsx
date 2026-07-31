export default function ForbiddenPage() {
  return (
    <main className="forbidden-page">
      <p className="eyebrow">403 · 权限不足</p>
      <h1>无权访问</h1>
      <p>此页面仅限管理员使用。</p>
      <a className="secondary-button inline-link" href="/home">返回首页</a>
    </main>
  );
}
