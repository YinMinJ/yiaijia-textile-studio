"use client";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  KeyRound,
  Save,
  FlaskConical,
  LoaderCircle,
  PlugZap,
} from "lucide-react";
type Configuration = {
  configured: boolean;
  protocol: "custom";
  baseUrl: string;
  model: string;
  textModel: string;
  keyHint: string;
};
export default function ModelSettings({
  signedIn,
  onSaved,
}: {
  signedIn: boolean;
  onSaved: (configured: boolean) => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [textModel, setTextModel] = useState("");
  const [key, setKey] = useState("");
  const [hint, setHint] = useState("");
  const [configured, setConfigured] = useState(false);
  const [busy, setBusy] = useState("");
  const [testImage, setTestImage] = useState("");
  const [error, setError] = useState("");
  const [connectionMessage, setConnectionMessage] = useState("");
  function clearResults() {
    setTestImage("");
    setConnectionMessage("");
    setError("");
  }
  useEffect(() => {
    if (!signedIn) return;
    fetch("/api/model-settings")
      .then(async (r) => {
        const d = (await r.json()) as Configuration & { error?: string };
        if (!r.ok) throw new Error(d.error);
        setBaseUrl(d.configured ? d.baseUrl : "");
        setModel(d.configured ? d.model : "");
        setTextModel(d.configured ? d.textModel || "" : "");
        setHint(d.configured ? d.keyHint : "");
        setConfigured(d.configured);
        onSaved(d.configured);
      })
      .catch((e) => setError(e.message));
  }, [signedIn, onSaved]);
  async function save() {
    if (!signedIn) {
      setError("请登录后配置自定义 API。");
      return false;
    }
    clearResults();
    if (!key.trim() && !configured) {
      setError("请填写当前服务商的 API Key 后保存或测试。");
      return false;
    }
    setBusy("保存中");
    try {
      const r = await fetch("/api/model-settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, model, textModel, apiKey: key }),
      });
      const d = (await r.json()) as Configuration & { error?: string };
      if (!r.ok) throw new Error(d.error || "保存失败");
      setConfigured(true);
      setBaseUrl(d.baseUrl);
      setModel(d.model);
      setTextModel(d.textModel || "");
      setHint(d.keyHint);
      setKey("");
      onSaved(true);
      toast.success("自定义 API 配置已加密保存");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy("");
    }
  }
  async function checkConnection() {
    if (!(await save())) return;
    setError("");
    setConnectionMessage("");
    setBusy("正在检测接口和模型列表");
    try {
      const r = await fetch("/api/model-settings/test", { method: "POST" });
      const d = (await r.json()) as { message?: string; error?: string };
      if (!r.ok) throw new Error(d.error || "连接检测失败");
      setConnectionMessage(d.message || "连接检测完成");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  async function test() {
    if (!(await save())) return;
    setError("");
    setBusy("试生成中，请保持页面打开");
    try {
      const source = await fetch("/samples/00224.jpg");
      if (!source.ok) throw new Error("测试素材读取失败");
      const form = new FormData();
      form.append("image", await source.blob(), "sample-quilt.jpg");
      form.set("test", "true");
      const r = await fetch("/api/generate-image", {
        method: "POST",
        body: form,
      });
      const d = (await r.json()) as { asset?: { url: string }; error?: string };
      if (!r.ok || !d.asset) throw new Error(d.error || "接口未返回可用图片");
      setTestImage(d.asset.url);
      toast.success("图片接口已真实返回结果，请检查商品还原效果。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <main className="page">
      <div className="section-heading">
        <div>
          <span className="eyebrow">YOUR CUSTOM API</span>
          <h1>自定义 API</h1>
          <p>接入你自己的兼容 API，分别设置图像和文案模型，生成费用由服务商账户承担。</p>
        </div>
      </div>
      <div className="settings-form">
        <h2>
          <KeyRound size={20} style={{ display: "inline", marginRight: 9 }} />
          自定义模型接口
        </h2>
        <div className="settings-status">
          {configured
            ? "已保存配置 · 密钥末四位 " + hint
            : "当前接口尚未配置密钥，也未验证连接；你可以先体验实拍排版样例。"}
        </div>
        {!signedIn && (
          <a
            href="/login"
            target="_top"
            className="btn"
          >
            登录后配置 API
          </a>
        )}
        <label>
          API Base URL
          <input
            type="url"
            value={baseUrl}
            disabled={!!busy}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              setKey("");
              setHint("");
              setConfigured(false);
              onSaved(false);
              clearResults();
            }}
            spellCheck={false}
            autoComplete="off"
            placeholder="https://api.example.com/v1"
          />
        </label>
        <p className="field-note">
          使用 OpenAI 兼容接口。只填域名会补上 /v1，也可填写完整的
          /images/edits 地址；文案会调用同一服务商的 /chat/completions 接口。
        </p>
        <label>
          图像模型名称
          <input
            value={model}
            disabled={!!busy}
            onChange={(e) => {
              setModel(e.target.value);
              clearResults();
            }}
            maxLength={100}
            spellCheck={false}
            placeholder="请填写支持图片编辑的模型名称"
          />
        </label>
        <label>
          文案模型名称
          <input
            value={textModel}
            disabled={!!busy}
            onChange={(e) => {
              setTextModel(e.target.value);
              clearResults();
            }}
            maxLength={100}
            spellCheck={false}
            placeholder="例如 deepseek-v4.1-flash"
          />
        </label>
        <p className="field-note">
          首图文案由你手动填写，其余图片可用文案模型自动编写。两个模型共用上面的接口地址和密钥；模型名称请按服务商提供的准确 ID 填写。
        </p>
        <label>
          API Key
          <input
            type="password"
            value={key}
            disabled={!!busy}
            onChange={(e) => {
              setKey(e.target.value);
              clearResults();
            }}
            autoComplete="new-password"
            spellCheck={false}
            placeholder={
              configured
                ? "已加密保存；留空保留当前密钥"
                : "填写当前服务商提供的 API Key"
            }
          />
        </label>
        <p className="field-note">
          密钥由后端加密保存，不会展示在页面源码或下载文件里。更换接口地址时，请重新填写对应密钥。
        </p>
        <div className="settings-actions">
          <button
            className="btn primary"
            disabled={!!busy}
            onClick={() => void save()}
          >
            <Save size={16} />
            保存配置
          </button>
          <button
            className="btn"
            disabled={!!busy || !model || !baseUrl}
            onClick={() => void checkConnection()}
          >
            <PlugZap size={16} />
            检测连接 · 不生成内容
          </button>
          <button
            className="btn"
            disabled={!!busy || !model || !baseUrl}
            onClick={() => void test()}
          >
            {busy ? (
              <LoaderCircle size={16} className="spin" />
            ) : (
              <FlaskConical size={16} />
            )}
            测试图片接口 · 生成 1 张
          </button>
        </div>
        <p className="field-note">
          连接检测只读取模型列表，不生成图片或文案。
          单图测试会使用被子样例实际生成 1
          张图片，可能产生服务商费用。保存配置不会发起生成。
        </p>
        {busy && (
          <p className="model-connection" role="status">
            {busy}
          </p>
        )}
        {connectionMessage && (
          <p className="model-connection" role="status">
            {connectionMessage}
          </p>
        )}
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {testImage && (
          <div className="test-result">
            <h3>真实接口返回结果</h3>
            <img
              src={testImage}
              alt="API真实试生成结果"
              style={{
                width: "100%",
                maxWidth: 360,
                borderRadius: 8,
                marginTop: 14,
              }}
            />
          </div>
        )}
        <div className="soft-note">
          <span>
            图片优化需要 /images/edits 接口，自动文案需要 /chat/completions 接口。文案生成会保留你的首图标题和说明，其余图仍可逐张修改。
          </span>
        </div>
      </div>
    </main>
  );
}
