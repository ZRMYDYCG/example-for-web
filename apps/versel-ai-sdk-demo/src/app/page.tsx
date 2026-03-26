"use client";

import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";

type MessagePart = UIMessage["parts"][number];
type ToolStatePart = Extract<MessagePart, { state: string }>;

type GenUIBlock = {
  component: string;
  props?: Record<string, unknown>;
};

type SearchResultItem = {
  title: string;
  url: string;
  snippet?: string;
};

type GenUIEnvelope = {
  type: "genui";
  version: string;
  blocks: GenUIBlock[];
};

type ParsedGenUI = {
  fullMatch: string;
  payload: GenUIEnvelope;
};

function formatToolName(part: MessagePart) {
  if (part.type === "dynamic-tool" && "toolName" in part) {
    return part.toolName;
  }

  if (part.type.startsWith("tool-")) {
    return part.type.replace(/^tool-/, "");
  }

  return "unknown";
}

function parseGenUIFromText(text: string): ParsedGenUI | null {
  const pattern = /```json\s*([\s\S]*?)```/g;
  const matches = Array.from(text.matchAll(pattern));

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index];
    const raw = match[1]?.trim();

    if (!raw) {
      continue;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<GenUIEnvelope>;
      if (
        parsed &&
        parsed.type === "genui" &&
        typeof parsed.version === "string" &&
        Array.isArray(parsed.blocks)
      ) {
        return {
          fullMatch: match[0],
          payload: parsed as GenUIEnvelope,
        };
      }
    } catch {}
  }

  return null;
}

function MarkdownBlock({ text }: { text: string }) {
  const normalizedMarkdown = text
    .replace(/\r\n/g, "\n")
    .replace(/(^|\n)(#{1,6})([^\s#])/g, "$1$2 $3")
    .replace(/([^\n])(\s#{1,6}\s)/g, "$1\n\n$2")
    .replace(/(^|\n)(\d+)\.(\S)/g, "$1$2. $3")
    .replace(/(^|\n)([-*+])(\S)/g, "$1$2 $3")
    .trim();

  return (
    <div className="prose prose-sm max-w-none leading-7 prose-p:my-2 prose-pre:my-2 prose-pre:overflow-auto prose-pre:rounded-lg prose-pre:bg-gray-100 prose-pre:p-3">
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]}>
        {normalizedMarkdown}
      </ReactMarkdown>
    </div>
  );
}

function ToolInvocationBlock({ part }: { part: ToolStatePart }) {
  return (
    <div className="space-y-2 rounded-xl border bg-gray-50 p-3">
      <div className="text-xs font-medium text-gray-600">
        工具调用 · {formatToolName(part)} · {part.state}
      </div>
      {"input" in part && part.input !== undefined ? (
        <pre className="overflow-auto rounded-lg bg-white p-2 text-xs">
          {JSON.stringify(part.input, null, 2)}
        </pre>
      ) : null}
      {"output" in part && part.output !== undefined ? (
        <pre className="overflow-auto rounded-lg bg-white p-2 text-xs">
          {JSON.stringify(part.output, null, 2)}
        </pre>
      ) : null}
      {"errorText" in part && part.errorText ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700">
          {part.errorText}
        </div>
      ) : null}
    </div>
  );
}

function GenUIBlockRenderer({ block }: { block: GenUIBlock }) {
  const title = typeof block.props?.title === "string" ? block.props.title : undefined;
  const content = typeof block.props?.content === "string" ? block.props.content : undefined;
  const items = Array.isArray(block.props?.items)
    ? block.props.items.filter((item): item is string => typeof item === "string")
    : [];
  const searchItems = Array.isArray(block.props?.items)
    ? block.props.items.filter(
        (item): item is SearchResultItem =>
          typeof item === "object" &&
          item !== null &&
          "title" in item &&
          typeof item.title === "string" &&
          "url" in item &&
          typeof item.url === "string" &&
          (!("snippet" in item) || typeof item.snippet === "string"),
      )
    : [];
  const buttonText =
    typeof block.props?.buttonText === "string" ? block.props.buttonText : "立即执行";

  if (block.component === "summary" || block.component === "paragraph") {
    return (
      <div className="rounded-xl border bg-white p-4">
        {title ? <div className="mb-1 text-sm font-semibold text-gray-900">{title}</div> : null}
        {content ? <div className="text-sm leading-7 text-gray-700">{content}</div> : null}
      </div>
    );
  }

  if (block.component === "headline-list" || block.component === "checklist") {
    return (
      <div className="rounded-xl border bg-white p-4">
        {title ? <div className="mb-2 text-sm font-semibold text-gray-900">{title}</div> : null}
        <ul className="space-y-1 text-sm text-gray-700">
          {items.map((item, index) => (
            <li key={`${block.component}-${index}`}>- {item}</li>
          ))}
        </ul>
      </div>
    );
  }

  if (block.component === "cta") {
    return (
      <div className="rounded-xl border bg-white p-4">
        {title ? <div className="mb-2 text-sm font-semibold text-gray-900">{title}</div> : null}
        <button type="button" className="rounded-lg border px-3 py-2 text-sm">
          {buttonText}
        </button>
      </div>
    );
  }

  if (block.component === "search-results") {
    return (
      <div className="rounded-xl border bg-white p-4">
        {title ? <div className="mb-2 text-sm font-semibold text-gray-900">{title}</div> : null}
        <div className="space-y-2">
          {searchItems.map((item, index) => (
            <a
              key={`${item.url}-${index}`}
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="block rounded-lg border p-2"
            >
              <div className="text-sm font-medium text-blue-700 underline">{item.title}</div>
              {item.snippet ? <div className="mt-1 text-xs text-gray-600">{item.snippet}</div> : null}
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <pre className="overflow-auto rounded-xl bg-gray-50 p-3 text-xs">
      {JSON.stringify(block, null, 2)}
    </pre>
  );
}

function GenUIRenderer({ payload }: { payload: GenUIEnvelope }) {
  return (
    <div className="space-y-2 rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
      <div className="text-xs font-medium text-indigo-700">
        GenUI 渲染 · v{payload.version} · {payload.blocks.length} blocks
      </div>
      <div className="space-y-2">
        {payload.blocks.map((block, index) => (
          <GenUIBlockRenderer key={`${block.component}-${index}`} block={block} />
        ))}
      </div>
    </div>
  );
}

function TextPartBlock({ text }: { text: string }) {
  const parsed = parseGenUIFromText(text);
  const markdownText = parsed ? text.replace(parsed.fullMatch, "").trim() : text;

  return (
    <div className="space-y-3">
      {markdownText ? <MarkdownBlock text={markdownText} /> : null}
      {parsed ? <GenUIRenderer payload={parsed.payload} /> : null}
    </div>
  );
}

function collectToolEvents(messages: UIMessage[]) {
  const events: Array<{
    id: string;
    name: string;
    state: string;
    input?: unknown;
    output?: unknown;
    errorText?: string;
  }> = [];

  messages.forEach((message) => {
    message.parts.forEach((part, index) => {
      if ((part.type.startsWith("tool-") || part.type === "dynamic-tool") && "state" in part) {
        events.push({
          id: `${message.id}-${index}`,
          name: formatToolName(part),
          state: typeof part.state === "string" ? part.state : "unknown",
          input: "input" in part ? part.input : undefined,
          output: "output" in part ? part.output : undefined,
          errorText: "errorText" in part ? part.errorText : undefined,
        });
      }
    });
  });

  return events;
}

function renderMessagePart(part: MessagePart, key: string) {
  if (part.type === "step-start") {
    return <div key={key} className="my-2 border-t border-dashed border-gray-200" />;
  }

  if (part.type === "text") {
    return <TextPartBlock key={key} text={part.text} />;
  }

  if (part.type === "reasoning") {
    return (
      <details key={key} className="rounded-xl border bg-amber-50/60 p-3">
        <summary className="cursor-pointer text-xs text-amber-700">推理过程</summary>
        <div className="mt-2 text-sm leading-7 text-amber-900">
          <MarkdownBlock text={part.text} />
        </div>
      </details>
    );
  }

  if ((part.type.startsWith("tool-") || part.type === "dynamic-tool") && "state" in part) {
    return <ToolInvocationBlock key={key} part={part} />;
  }

  if (part.type === "file") {
    return (
      <div key={key} className="rounded-xl border bg-gray-50 p-3 text-xs">
        附件：{part.filename ?? part.mediaType}
      </div>
    );
  }

  if (part.type === "source-url") {
    return (
      <a
        key={key}
        href={part.url}
        target="_blank"
        rel="noreferrer"
        className="block rounded-xl border bg-gray-50 p-3 text-xs text-blue-600 underline"
      >
        参考链接：{part.url}
      </a>
    );
  }

  if (part.type === "source-document") {
    return (
      <div key={key} className="rounded-xl border bg-gray-50 p-3 text-xs">
        参考文档：{part.title}
      </div>
    );
  }

  return (
    <pre key={key} className="overflow-auto rounded-xl bg-gray-50 p-3 text-xs">
      {JSON.stringify(part, null, 2)}
    </pre>
  );
}

export default function Home() {
  const [input, setInput] = useState("");

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });
  const toolEvents = collectToolEvents(messages);

  return (
    <main className="mx-auto min-h-screen w-full max-w-6xl px-6 py-8">
      <header className="mb-6 space-y-2">
        <h1 className="text-2xl font-bold">文案生成 Agent</h1>
        <p className="text-sm text-gray-500">
          输入你的产品、受众和渠道，Agent 会调用工具并输出可渲染的 GenUI JSON
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <section className="space-y-4">
          {error ? (
            <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
              模型服务连接失败，请确认网络可访问硅基流动 API，或稍后重试。
            </div>
          ) : null}

          {messages.length === 0 ? (
            <div className="rounded-2xl border border-dashed p-4 text-sm text-gray-500">
              例如：产品是 AI 面试助手，目标受众是应届生，渠道小红书，目标是拉新注册，语气亲和自然
            </div>
          ) : null}

          {messages.map((message) => (
            <div key={message.id} className="rounded-2xl border p-4">
              <div className="mb-2 text-sm font-medium text-gray-500">
                {message.role === "user" ? "你" : "Agent"}
              </div>

              <div className="space-y-3">
                {message.parts.map((part, index) =>
                  renderMessagePart(part, `${message.id}-${index}`),
                )}
              </div>
            </div>
          ))}

          <form
            className="flex gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              const text = input.trim();
              if (!text) {
                return;
              }

              sendMessage({ text });
              setInput("");
            }}
          >
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="例如：给 SaaS 项目管理工具写一版公众号拉新文案，语气专业可信，附 6 个标题"
              className="flex-1 rounded-xl border px-4 py-3 outline-none"
            />
            <button
              type="submit"
              disabled={status === "streaming" || status === "submitted"}
              className="rounded-xl border px-5 py-3 disabled:opacity-50"
            >
              发送
            </button>
          </form>
        </section>

        <aside className="h-fit space-y-3 rounded-2xl border p-4">
          <div className="text-sm font-semibold">工具调用观察</div>
          {toolEvents.length === 0 ? (
            <div className="text-xs text-gray-500">尚未触发工具调用</div>
          ) : (
            <div className="space-y-2">
              {toolEvents.map((event, index) => (
                <div key={event.id} className="rounded-xl border bg-gray-50 p-3">
                  <div className="text-xs font-medium text-gray-700">
                    #{index + 1} {event.name} · {event.state}
                  </div>
                  {event.input !== undefined ? (
                    <pre className="mt-2 overflow-auto rounded bg-white p-2 text-[11px]">
                      {JSON.stringify(event.input, null, 2)}
                    </pre>
                  ) : null}
                  {event.output !== undefined ? (
                    <pre className="mt-2 overflow-auto rounded bg-white p-2 text-[11px]">
                      {JSON.stringify(event.output, null, 2)}
                    </pre>
                  ) : null}
                  {event.errorText ? (
                    <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-[11px] text-red-700">
                      {event.errorText}
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
