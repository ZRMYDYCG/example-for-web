import { createOpenAI } from '@ai-sdk/openai'
import { convertToModelMessages, stepCountIs, streamText, type UIMessage } from 'ai'
import { tools } from '@/lib/tools'

export async function POST(req: Request) {
  const apiKey = process.env.SILICON_FLOW_API_KEY as string
  const baseURL = process.env.SILICON_FLOW_BASE_URL as string
  const modelName = process.env.SILICON_FLOW_MODEL as string

  const siliconflow = createOpenAI({
    apiKey,
    baseURL,
  })

  try {
    const { messages }: { messages: UIMessage[] } = await req.json()

    const result = streamText({
      model: siliconflow.chat(modelName),
      system: `
你是资深增长文案 Agent，专注产出可直接投放的文案方案。

工作方式：
1. 先澄清目标：识别产品、受众、渠道、转化目标、语气约束。
2. 工具优先：涉及策略拆解、标题候选、渠道改写时优先调用工具。
3. 遇到“行业趋势、竞品动向、热点话题、数据佐证”时，优先调用 searchWebContext 联网搜索。
4. 输出可执行：给出可直接复制使用的文案与结构化建议。
5. 连续透明：每次工具调用后都基于工具结果继续完善，不要空泛描述。

输出格式：
1. 先输出 Markdown，包含：
- 目标理解
- 文案策略
- 可直接使用文案
- A/B 测试建议
2. 然后必须追加一个 \`\`\`json 代码块，内容为 GenUI 协议：
\`\`\`json
{
  "type": "genui",
  "version": "1.0",
  "blocks": [
    { "component": "summary", "props": { "title": "策略总览", "content": "..." } },
    { "component": "headline-list", "props": { "title": "标题候选", "items": ["..."] } },
    { "component": "search-results", "props": { "title": "联网搜索参考", "items": [{"title":"...","url":"...","snippet":"..."}] } },
    { "component": "paragraph", "props": { "title": "正文草案", "content": "..." } },
    { "component": "checklist", "props": { "title": "执行清单", "items": ["..."] } }
  ]
}
\`\`\`
3. JSON 必须合法可解析，字段名固定为 type/version/blocks/component/props。
4. 不要在 JSON 代码块外重复输出同一份 JSON。
`,
      messages: await convertToModelMessages(messages),
      tools,
      stopWhen: stepCountIs(8),
      maxRetries: 2,
      temperature: 0.4,
    })

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        const errorMessage = error instanceof Error ? error.message : String(error)

        if (errorMessage.includes('Unauthorized') || errorMessage.includes('Invalid token')) {
          return '硅基流动鉴权失败，请检查 SILICON_FLOW_API_KEY 是否正确且可用。'
        }

        if (errorMessage.includes('Not Found')) {
          return '硅基流动接口地址不可用，请检查 SILICON_FLOW_BASE_URL 配置。'
        }

        return '模型服务暂时不可用，请检查网络或稍后重试。'
      },
    })
  } catch {
    return Response.json(
      {
        error: '模型服务连接失败，请确认当前网络可访问硅基流动 API 后重试。',
      },
      { status: 503 },
    )
  }
}
