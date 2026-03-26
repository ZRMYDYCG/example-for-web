## 这次 demo 的目标

我建议你做一个：

# **技术方案拆解助手（Next.js + Vercel AI SDK）**

用户输入一个需求，比如：

> 做一个活动报名页，需要手机号验证码、表单校验、报名状态查询和管理后台导出

AI 助手会：

1. **流式回复**需求分析
2. 必要时**调用工具**查询“团队规范 / 现有组件能力”
3. 最后输出一份**可执行的技术方案**

这条路线很适合团队分享，因为 AI SDK 官方本身就把它定位成 **构建 AI applications and agents 的 TypeScript toolkit**；同时官方 Next.js quickstart 也是“**简单 agent + streaming chat UI**”这条路。对于 agent 场景，官方推荐的抽象是 **ToolLoopAgent**，但也明确说：当你需要更显式地控制每一步时，可以先用 `generateText` / `streamText`。([AI SDK][1])

---

# 先定技术路线

## 第一阶段：先做最稳的 MVP

这版我建议用：

* **Next.js App Router**
* **Route Handler** 做 `/api/chat`
* 前端用 **`useChat`**
* 后端用 **`streamText`**
* 用 **tools** 做“查团队规范 / 查组件目录”
* 用 **`stopWhen`** 支持多步 tool calls

这么选的原因很简单：

* Next 的 **Route Handlers** 就是 App Router 里的服务端接口，基于 Web `Request` / `Response` API。([Next.js][2])
* `useChat` 现在是 **transport-based architecture**，不再自己管理 input state；官方 cookbook 的 Next 示例也是 `useChat + DefaultChatTransport + /api/chat` 这种写法。([AI SDK][3])
* `streamText` + `tools` + `stopWhen` 可以直接做 **multi-step tool calling**，这是最像“agent 行为”的最小闭环。([AI SDK][4])

## 第二阶段：再升级成真正的 Agent

等 MVP 跑通后，再把后端逻辑抽出来，升级成 **`ToolLoopAgent`**。因为官方明确说它是 **recommended approach**，适合多步、可复用、可维护的 agent。([AI SDK][5])

---

# 你这次分享可以讲的核心点

## 1. AI SDK 不只是聊天库

它分成两层：

* **AI SDK Core**：统一模型调用、结构化输出、tool calling、agent
* **AI SDK UI**：像 `useChat` 这样的前端交互能力

这是官方文档直接给出的分层。([AI SDK][1])

## 2. “agent” 本质上先从 tools 开始

官方文档里，多步工具调用的核心就是：

* 模型先决定是否调用工具
* 工具执行后把结果回传给模型
* 模型继续下一步
* 直到满足停止条件

这正是 `stopWhen` 的作用。([AI SDK][4])

## 3. 结构化输出能让 demo 更像业务系统

AI SDK 支持在 `generateText` / `streamText` 里通过 `output` 生成结构化对象，并且支持 Zod / JSON Schema 校验；而且它可以和 tool calling 放在同一条链路里。([AI SDK][6])

---

# 项目结构

先做一个最小但像样的目录：

```txt
app/
  api/
    chat/
      route.ts
  page.tsx
lib/
  tools.ts
.env.local
```

---

# 安装依赖

```bash
pnpm create next-app@latest vercel-ai-sdk-demo --ts --app --eslint
cd vercel-ai-sdk-demo
pnpm add ai @ai-sdk/react @ai-sdk/openai zod
```

---

# 环境变量

`.env.local`

```bash
OPENAI_API_KEY=your_api_key_here
```

---

# 第一步：抽出 tools

`lib/tools.ts`

```ts
import { tool } from 'ai'
import { z } from 'zod'

export const tools = {
  getTeamConvention: tool({
    description: '查询团队研发规范，例如目录约定、组件封装规范、接口请求约定',
    inputSchema: z.object({
      topic: z.string().describe('要查询的规范主题'),
    }),
    execute: async ({ topic }) => {
      const data: Record<string, string> = {
        '目录规范': '采用 App Router；业务逻辑优先下沉到 hooks；服务端与客户端边界明确。',
        '组件规范': '优先复用业务组件；表单统一封装；列表页统一空态/错误态。',
        '请求规范': '请求层统一封装；错误码统一处理；列表接口保留分页与筛选参数。',
      }

      return {
        topic,
        content: data[topic] ?? '当前没有命中该主题规范，请人工补充。',
      }
    },
  }),

  searchComponentCatalog: tool({
    description: '查询已有组件能力，避免重复造轮子',
    inputSchema: z.object({
      keyword: z.string().describe('要搜索的组件关键词'),
    }),
    execute: async ({ keyword }) => {
      const catalog = [
        'MasonTable：通用表格组件，支持分页、操作列、插槽扩展',
        'UploadPanel：上传面板，支持拖拽上传、进度反馈',
        'SearchForm：查询表单组件，支持折叠/展开',
        'EmptyState：统一空状态组件',
      ]

      return {
        keyword,
        matches: catalog.filter(item => item.includes(keyword) || keyword.length <= 2),
      }
    },
  }),
}
```

---

# 第二步：做 Route Handler

`app/api/chat/route.ts`

```ts
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai'
import { openai } from '@ai-sdk/openai'
import { tools } from '@/lib/tools'

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json()

  const result = streamText({
    model: openai('gpt-4.1-mini'),
    system: `
你是团队内部的“技术方案拆解助手”。

你的职责：
1. 先理解用户需求
2. 在需要时调用工具查询团队规范或已有组件能力
3. 给出清晰、可执行、工程化的方案
4. 输出内容尽量包含：需求理解、页面拆分、状态设计、接口设计、风险点
`,
    messages: await convertToModelMessages(messages),
    tools,
    stopWhen: stepCountIs(5),
  })

  return result.toUIMessageStreamResponse()
}
```

这里的关键点有三个：

* `streamText` 负责**流式输出**
* `tools` 让模型能访问外部能力
* `stopWhen: stepCountIs(5)` 让它支持**多步工具调用**，而不是只调用一次工具就停住。AI SDK 官方对多步工具调用的说明就是基于 `generateText` / `streamText` + `stopWhen`。([AI SDK][4])

---

# 第三步：做聊天页

`app/page.tsx`

```tsx
'use client'

import { useState } from 'react'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'

export default function Page() {
  const [input, setInput] = useState('')

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
  })

  return (
    <main className="mx-auto min-h-screen max-w-4xl p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">技术方案拆解助手</h1>
        <p className="mt-2 text-sm text-gray-500">
          输入一个需求，让 AI 边分析边输出，并在需要时自动调用工具
        </p>
      </header>

      <section className="mb-6 space-y-4">
        {messages.map(message => (
          <div key={message.id} className="rounded-2xl border p-4">
            <div className="mb-2 text-sm font-medium text-gray-500">
              {message.role === 'user' ? '你' : 'AI'}
            </div>

            <div className="space-y-3">
              {message.parts.map((part, index) => {
                if (part.type === 'text') {
                  return (
                    <div key={index} className="whitespace-pre-wrap leading-7">
                      {part.text}
                    </div>
                  )
                }

                return (
                  <pre
                    key={index}
                    className="overflow-auto rounded-xl bg-gray-50 p-3 text-xs"
                  >
                    {JSON.stringify(part, null, 2)}
                  </pre>
                )
              })}
            </div>
          </div>
        ))}
      </section>

      <form
        className="flex gap-3"
        onSubmit={e => {
          e.preventDefault()
          const text = input.trim()
          if (!text) return

          sendMessage({ text })
          setInput('')
        }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="例如：做一个活动报名页，帮我拆成页面、组件、接口和风险点"
          className="flex-1 rounded-xl border px-4 py-3 outline-none"
        />
        <button
          type="submit"
          disabled={status === 'streaming' || status === 'submitted'}
          className="rounded-xl border px-5 py-3 disabled:opacity-50"
        >
          发送
        </button>
      </form>
    </main>
  )
}
```

这块的设计和官方现在的 `useChat` 思路一致：`useChat` 负责聊天状态与流式消息，网络层通过 `transport` 接到 `/api/chat`。官方文档也明确写了：`useChat` 已改成 transport 架构，不再自己管理 input state。([AI SDK][3])

---

# 这版 demo 你现场怎么演示

你可以直接输入这几类问题：

## 场景 1：普通需求拆解

> 做一个活动报名页，要求手机号验证码登录、报名表单、提交成功页、报名状态查询页

看点：

* AI 会流式输出
* 不一定调用工具

## 场景 2：触发团队规范工具

> 按我们团队目录规范，设计一个活动报名页的前端目录结构

看点：

* 会调用 `getTeamConvention`

## 场景 3：触发现有组件目录工具

> 如果做一个带列表和筛选的报名管理页，我们现有组件里有哪些能复用

看点：

* 会调用 `searchComponentCatalog`

---

# 这版 demo 的分享话术

你可以这样讲：

## 先讲定位

> 我们不是在做一个“问答机器人”，而是在做一个“有外部能力的应用型 agent”。

## 再讲技术核心

> 它不是单轮 prompt，而是：
>
> * 用户发起请求
> * 模型决定是否调用工具
> * 工具执行拿到外部信息
> * 再继续生成答案
> * 直到满足停止条件

这正是 AI SDK 官方对 multi-step tool calls 和 agent loop 的解释。([AI SDK][4])

## 最后讲工程价值

> 这个模式天然适合接：
>
> * 团队规范
> * 组件目录
> * 接口文档
> * 内部知识库
> * 工单系统
> * 发布审批流

---

# 下一步升级：把“文本回答”升级成“结构化方案”

这个是第二阶段最值得加的点。

AI SDK 官方支持通过 `output` 生成结构化对象，并且它可以和 tool calling 组合使用。([AI SDK][6])

例如单独做一个 `/api/plan`：

```ts
import { generateText, Output } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import { tools } from '@/lib/tools'

const planSchema = z.object({
  summary: z.string(),
  pages: z.array(z.string()),
  apis: z.array(z.string()),
  risks: z.array(z.string()),
  todo: z.array(z.string()),
})

export async function POST(req: Request) {
  const { prompt }: { prompt: string } = await req.json()

  const result = await generateText({
    model: openai('gpt-4.1-mini'),
    prompt,
    tools,
    output: Output.object({
      schema: planSchema,
    }),
  })

  return Response.json(result.output)
}
```

这样你就可以在分享里强调：

> 第一版是“可聊天的 agent”
> 第二版是“能产出结构化业务结果的 agent”

这是从 demo 走向业务化的关键一步。官方文档也提醒了一点：**当 `output` 和 tool calling 一起使用时，结构化输出本身也算一步执行**，所以 `stopWhen` 要留够步数。([AI SDK][6])

---

# 再下一步：升级成真正的 ToolLoopAgent

当你们团队接受这个思路后，再把“聊天 route 里的逻辑”抽出来。

因为官方现在推荐多数 agent 场景直接使用 **ToolLoopAgent**，它会把：

* model
* tools
* stopWhen
* loop 控制

都封装成一个可复用 agent。([AI SDK][5])

到那时，你的演进路径就会很清晰：

## 路线图

1. `useChat + streamText + tools`
2. `streamText + tools + output`
3. `ToolLoopAgent`
4. `needsApproval` 加人工审批
5. 接内部系统 / MCP / 知识库

如果你后面要做“创建 Jira、发通知、执行发布”这类动作，官方还提供了 **human-in-the-loop** 方案，基于工具的 `needsApproval` 做审批。([AI SDK][7])

---

# 你这次分享的 PPT 提纲，我也给你定了

## 标题

**基于 Next.js + Vercel AI SDK 构建可流式、可调用工具的应用型 Agent Demo**

## 大纲

### 1. 为什么不是只做聊天框

* 纯对话价值有限
* 真正的业务价值来自 tools / workflow / structured output

### 2. Vercel AI SDK 的能力边界

* Core / UI 分层
* Next 集成顺滑
* 支持 applications and agents ([AI SDK][1])

### 3. Demo 架构

* `useChat`
* `DefaultChatTransport`
* `/api/chat`
* `streamText`
* `tools`
* `stopWhen`

### 4. 现场演示

* 普通需求拆解
* 触发团队规范
* 触发组件目录

### 5. 可扩展方向

* structured output
* ToolLoopAgent
* HITL approval
* 内部知识库 / MCP

### 6. 结论

* 先从“有工具能力的聊天”开始
* 再逐步演进成真正 agent

---

# 我给你的最终建议

这次不要追求“大而全”。
**先把第一阶段 demo 跑通，效果就已经够你做一次很漂亮的技术分享了。**

下一条我可以直接继续给你：

**完整可运行版代码（包含更好看的 UI、示例 prompt、以及结构化输出版本）**。

[1]: https://ai-sdk.dev/docs/introduction "AI SDK by Vercel"
[2]: https://nextjs.org/docs/app/getting-started/route-handlers "Getting Started: Route Handlers | Next.js"
[3]: https://ai-sdk.dev/docs/reference/ai-sdk-ui/use-chat "AI SDK UI: useChat"
[4]: https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling "AI SDK Core: Tool Calling"
[5]: https://ai-sdk.dev/docs/agents/overview "Agents: Overview"
[6]: https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data "AI SDK Core: Generating Structured Data"
[7]: https://ai-sdk.dev/cookbook/next/human-in-the-loop "Next.js: Human-in-the-Loop with Next.js"
