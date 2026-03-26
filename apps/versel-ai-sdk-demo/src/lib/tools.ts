import { tool } from 'ai'
import { z } from 'zod'

function normalizeKeyword(text: string) {
  return text.toLowerCase().replace(/\s+/g, '')
}

type DuckDuckGoTopic = {
  Text?: string
  FirstURL?: string
  Result?: string
  Name?: string
  Topics?: DuckDuckGoTopic[]
}

type DuckDuckGoResponse = {
  AbstractText?: string
  AbstractURL?: string
  RelatedTopics?: DuckDuckGoTopic[]
}

const channelStructureMap: Record<string, string[]> = {
  小红书: ['痛点切入', '人设背书', '解决方案', '场景体验', '行动引导'],
  抖音: ['3 秒钩子', '核心利益点', '使用场景', '限时驱动', '行动引导'],
  公众号: ['问题引入', '价值阐述', '证据支撑', '方案展开', '行动引导'],
  着陆页: ['标题承诺', '卖点拆解', '证据陈列', '异议处理', '行动引导'],
  短信: ['身份说明', '利益点', '时效提醒', '行动引导'],
}

const toneGuideMap: Record<string, string> = {
  专业可信: '强调事实、数据、可验证承诺，避免夸张表达',
  亲和自然: '使用生活化表达，减少术语，突出陪伴感',
  高能促销: '强调时效和利益点，句式短促有节奏',
  品牌叙事: '突出品牌价值观与长期认同感',
}

function buildHeadlineVariants(params: {
  product: string
  audience: string
  goal: string
  tone: string
  keywords: string[]
  count: number
}) {
  const { product, audience, goal, tone, keywords, count } = params
  const keywordText = keywords.length > 0 ? `，聚焦${keywords.join('、')}` : ''
  const templates = [
    `给${audience}的${product}：${goal}不再难${keywordText}`,
    `${tone}推荐｜${product}帮你实现${goal}${keywordText}`,
    `如果你是${audience}，这条${product}信息别错过`,
    `${product}新提案：围绕${goal}的更优解`,
    `${audience}都在关注：${product}${keywordText}`,
    `从现在开始，用${product}把${goal}做得更稳`,
    `${tone}表达版：${product}如何服务${audience}`,
    `一条说清${product}价值的标题：${goal}`,
  ]

  return Array.from(new Set(templates)).slice(0, count)
}

function flattenDuckDuckGoTopics(topics: DuckDuckGoTopic[] = []): DuckDuckGoTopic[] {
  return topics.flatMap((topic) => {
    if (Array.isArray(topic.Topics) && topic.Topics.length > 0) {
      return flattenDuckDuckGoTopics(topic.Topics)
    }

    return [topic]
  })
}

export const tools = {
  buildCopyStrategy: tool({
    description: '根据目标、受众和渠道，生成可执行的文案策略骨架',
    inputSchema: z.object({
      product: z.string().describe('产品或服务名称'),
      audience: z.string().describe('目标受众'),
      goal: z.string().describe('文案目标，例如拉新、转化、激活'),
      channel: z.string().describe('投放渠道，例如小红书、公众号、着陆页'),
      tone: z.string().default('专业可信').describe('表达语气'),
      highlights: z.array(z.string()).default([]).describe('核心卖点列表'),
      cta: z.string().default('立即了解').describe('行动号召'),
    }),
    execute: async ({ product, audience, goal, channel, tone, highlights, cta }) => {
      const structure = channelStructureMap[channel] ?? ['痛点', '价值', '证据', '行动引导']
      const messagePillars =
        highlights.length > 0 ? highlights : [`${product}核心优势`, `${audience}核心诉求`, `${goal}结果承诺`]

      return {
        product,
        audience,
        goal,
        channel,
        tone,
        toneGuide: toneGuideMap[tone] ?? toneGuideMap.专业可信,
        structure,
        messagePillars,
        cta,
        checklist: [
          '首屏有明确收益承诺',
          '每段围绕一个核心卖点',
          '至少一处可验证证据',
          '结尾给出明确行动路径',
        ],
      }
    },
  }),

  generateHeadlineVariants: tool({
    description: '批量生成标题候选，支持受众、目标、语气和关键词约束',
    inputSchema: z.object({
      product: z.string().describe('产品或服务名称'),
      audience: z.string().describe('目标受众'),
      goal: z.string().describe('文案目标'),
      tone: z.string().default('专业可信').describe('表达语气'),
      keywords: z.array(z.string()).default([]).describe('希望覆盖的关键词'),
      count: z.number().int().min(1).max(8).default(5).describe('返回标题数量'),
    }),
    execute: async ({ product, audience, goal, tone, keywords, count }) => {
      const headlines = buildHeadlineVariants({
        product,
        audience,
        goal,
        tone,
        keywords,
        count,
      })

      return {
        product,
        audience,
        goal,
        tone,
        headlines,
        total: headlines.length,
      }
    },
  }),

  adaptCopyForChannel: tool({
    description: '按渠道和长度限制重写文案，输出精简版本与风险提示',
    inputSchema: z.object({
      copy: z.string().describe('原始文案'),
      channel: z.string().describe('目标渠道'),
      maxLength: z.number().int().min(20).max(1000).default(140).describe('最大字数'),
    }),
    execute: async ({ copy, channel, maxLength }) => {
      const normalizedCopy = copy.trim()
      const adapted =
        normalizedCopy.length <= maxLength
          ? normalizedCopy
          : `${normalizedCopy.slice(0, Math.max(0, maxLength - 1))}…`

      return {
        channel,
        maxLength,
        adapted,
        originalLength: normalizedCopy.length,
        truncated: normalizedCopy.length > maxLength,
        reminders: [
          '保留单一核心诉求，避免多目标并列',
          '行动号召尽量放在前 2 句',
          '渠道敏感词和绝对化表达需二次审核',
        ],
      }
    },
  }),

  searchWebContext: tool({
    description: '联网搜索最新上下文信息，用于补充文案事实依据与趋势素材',
    inputSchema: z.object({
      query: z.string().describe('搜索关键词'),
      maxResults: z.number().int().min(1).max(8).default(5).describe('返回结果数量'),
    }),
    execute: async ({ query, maxResults }) => {
      const params = new URLSearchParams({
        q: query,
        format: 'json',
        no_html: '1',
        no_redirect: '1',
      })
      const response = await fetch(`https://api.duckduckgo.com/?${params.toString()}`)

      if (!response.ok) {
        return {
          query,
          results: [],
          total: 0,
          error: `搜索请求失败(${response.status})`,
        }
      }

      const data = (await response.json()) as DuckDuckGoResponse
      const abstractResult =
        data.AbstractText && data.AbstractURL
          ? [
              {
                title: query,
                url: data.AbstractURL,
                snippet: data.AbstractText,
                source: 'DuckDuckGo Abstract',
              },
            ]
          : []

      const relatedResults = flattenDuckDuckGoTopics(data.RelatedTopics)
        .map((item) => ({
          title: item.Text?.split(' - ')[0] ?? item.Text ?? '未命名结果',
          url: item.FirstURL ?? '',
          snippet: item.Text ?? '',
          source: 'DuckDuckGo RelatedTopics',
        }))
        .filter((item) => item.url && item.snippet)

      const merged = [...abstractResult, ...relatedResults].slice(0, maxResults)

      return {
        query,
        fetchedAt: new Date().toISOString(),
        results: merged,
        total: merged.length,
      }
    },
  }),
}
