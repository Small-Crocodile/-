import { GoogleGenAI, Type } from "@google/genai";
import { Operation, RecapType, Holding } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

function parseNumericString(val: any): number | null {
  if (!val) return null;
  const str = String(val);
  const numStr = str.replace(/[^0-9.-]+/g, '');
  if (!numStr) return null;
  let num = Number(numStr);
  if (str.includes('万')) {
    num *= 10000;
  }
  return isNaN(num) ? null : num;
}

export async function analyzeHoldingsScreenshot(base64Image: string, mimeType: string = "image/png"): Promise<Partial<Holding>[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Image,
          },
        },
        {
          text: "CRITICAL INSTRUCTION: This screenshot contains a LIST of MULTIPLE fund holdings. You MUST extract EVERY SINGLE ROW or CARD visible in the image. DO NOT STOP after the first record. If there are multiple holdings in the image, you must return multiple objects in the array. Extract the exact text for amounts and shares, including any currency symbols or units. If the fund code is not visible in the image, you MUST use the Google Search tool to find the correct 6-digit fund code based on the fund name (e.g., search for '易方达蓝筹精选 基金代码'). Return an array of holdings in JSON format. Ensure all text fields like fundName and sector are in Chinese.",
        },
      ],
    },
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          holdings: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                fundName: { type: Type.STRING, description: "Name of the fund" },
                fundCode: { type: Type.STRING, description: "Code of the fund" },
                amount: { type: Type.STRING, description: "Current market value. Extract exact text (e.g. '1000.00', '1,000元')" },
                shares: { type: Type.STRING, description: "Current shares. Extract exact text (e.g. '1000.00', '1,000份')" },
                costBasis: { type: Type.STRING, description: "Cost basis. Extract exact text" },
                returnRate: { type: Type.STRING, description: "Current return rate or yield. Extract exact text (e.g. '10.5%', '-5.2%')" },
                sector: { type: Type.STRING, description: "Inferred sector based on fund name. MUST be in Chinese (e.g., 科技, 医疗, 消费, 宽基, 新能源, 金融)" }
              }
            }
          }
        },
        required: ["holdings"]
      },
    },
  });

  try {
    let text = response.text;
    if (text.startsWith('```json')) {
      text = text.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    const result = JSON.parse(text);
    return (result.holdings || []).map((h: any) => ({
      ...h,
      amount: parseNumericString(h.amount),
      shares: parseNumericString(h.shares),
      costBasis: parseNumericString(h.costBasis),
      returnRate: parseNumericString(h.returnRate),
    }));
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    throw new Error("Could not extract data from screenshot");
  }
}

export async function analyzeOperationScreenshot(base64Image: string, mimeType: string = "image/png"): Promise<Partial<Operation>[]> {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: {
      parts: [
        {
          inlineData: {
            mimeType: mimeType,
            data: base64Image,
          },
        },
        {
          text: "CRITICAL INSTRUCTION: This screenshot contains a LIST of MULTIPLE fund trading operations. You MUST extract EVERY SINGLE ROW or CARD visible in the image. DO NOT STOP after the first record. If there are multiple operations in the image, you must return multiple objects in the array. Extract the exact text for amounts and shares, including any currency symbols or units (e.g., '1000.00', '1,000元', '1万'). If the fund code is not visible in the image, you MUST use the Google Search tool to find the correct 6-digit fund code based on the fund name (e.g., search for '易方达蓝筹精选 基金代码'). Return an array of operations in JSON format. Ensure all text fields like fundName, sector, and reason are in Chinese.",
        },
      ],
    },
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          operations: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                fundName: { type: Type.STRING, description: "Name of the fund" },
                fundCode: { type: Type.STRING, description: "Code of the fund" },
                type: { 
                  type: Type.STRING, 
                  description: "Type of operation (e.g., buy, sell, add, reduce, switch, observe). If unsure, extract the exact Chinese text."
                },
                amount: { type: Type.STRING, description: "Transaction amount. Extract exact text (e.g. '1000.00', '1,000元', '1万')" },
                shares: { type: Type.STRING, description: "Transaction shares. Extract exact text (e.g. '1000.00', '1,000份')" },
                returnRate: { type: Type.STRING, description: "Current return rate or yield. Extract exact text (e.g. '10.5%', '-5.2%')" },
                date: { type: Type.STRING, description: "Operation date/time" },
                reason: { type: Type.STRING, description: "Stated reason if any" },
                sector: { type: Type.STRING, description: "Inferred sector based on fund name. MUST be in Chinese (e.g., 科技, 医疗, 消费, 宽基, 新能源, 金融)" }
              }
            }
          }
        },
        required: ["operations"]
      },
    },
  });

  try {
    let text = response.text;
    if (text.startsWith('```json')) {
      text = text.replace(/^```json\n/, '').replace(/\n```$/, '');
    } else if (text.startsWith('```')) {
      text = text.replace(/^```\n/, '').replace(/\n```$/, '');
    }
    const result = JSON.parse(text);
    return (result.operations || []).map((o: any) => ({
      ...o,
      amount: parseNumericString(o.amount),
      shares: parseNumericString(o.shares),
      returnRate: parseNumericString(o.returnRate),
    }));
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    throw new Error("Could not extract data from screenshot");
  }
}

// Common fund name to code mapping for instant lookup and higher accuracy
const COMMON_FUND_MAPPING: Record<string, string> = {
  "沪深300ETF": "510300",
  "沪深300": "000300",
  "创业板ETF": "159915",
  "创业板": "399006",
  "上证50ETF": "510050",
  "中证500ETF": "510500",
  "恒生指数ETF": "513660",
  "恒生互联网ETF": "513330",
  "纳指ETF": "513100",
  "标普500ETF": "513500",
  "易方达蓝筹精选": "008282",
  "中欧医疗健康": "003095",
  "景顺长城新兴成长": "260108",
  "招商中证白酒": "161725",
  "富国天惠": "161005",
  "兴全趋势": "163402",
};

// Helper for JSONP requests to bypass CORS and use direct domestic connection
function jsonp(url: string, callbackName: string, timeout: number = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`JSONP request timeout: ${url}`));
    }, timeout);

    (window as any)[callbackName] = (data: any) => {
      clearTimeout(timer);
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error(`JSONP request failed: ${url}`));
    };

    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
      delete (window as any)[callbackName];
    };

    script.src = url;
    document.head.appendChild(script);
  });
}

export async function fetchFundCode(fundName: string): Promise<string | null> {
  if (!fundName) return null;

  try {
    // 1. Local Dictionary Lookup (Instant)
    const cleanName = fundName.trim();
    if (COMMON_FUND_MAPPING[cleanName]) {
      return COMMON_FUND_MAPPING[cleanName];
    }
    
    // Partial match in dictionary
    for (const [name, code] of Object.entries(COMMON_FUND_MAPPING)) {
      if (cleanName.includes(name) || name.includes(cleanName)) {
        return code;
      }
    }

    // 2. Try EastMoney Search API - Direct JSONP (Domestic optimization)
    try {
      const searchUrl = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(fundName)}&callback=jsonp_callback_fundsearch`;
      const parsed = await jsonp(searchUrl, 'jsonp_callback_fundsearch', 2500);
      
      if (parsed && parsed.ErrCode === 0 && parsed.Datas && parsed.Datas.length > 0) {
        const bestMatch = parsed.Datas.find((d: any) => d.NAME.includes(fundName) || fundName.includes(d.NAME)) || parsed.Datas[0];
        const code = bestMatch.CODE;
        if (code && code.length === 6) {
          return code;
        }
      }
    } catch (e) {
      console.warn("EastMoney direct JSONP failed, trying proxy...", e);
      
      // Fallback to Proxy for EastMoney
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(fundName)}`)}`;
        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && data.contents) {
            const parsed = JSON.parse(data.contents);
            if (parsed.ErrCode === 0 && parsed.Datas && parsed.Datas.length > 0) {
              const bestMatch = parsed.Datas.find((d: any) => d.NAME.includes(fundName) || fundName.includes(d.NAME)) || parsed.Datas[0];
              const code = bestMatch.CODE;
              if (code && code.length === 6) return code;
            }
          }
        }
      } catch (proxyErr) {
        console.warn("EastMoney proxy search failed", proxyErr);
      }
    }

    // 3. Fallback to Gemini with Google Search (Most Reliable)
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `请查找中国公募基金“${fundName}”的6位数字基金代码。
      要求：
      1. 只返回6位数字代码（如 008282），不要有任何其他文字。
      2. 如果是分级基金或有A/C类，请优先返回A类或主代码。
      3. 如果实在找不到，请返回 "NOT_FOUND"。`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    
    const text = response.text?.trim() || '';
    const match = text.match(/\b\d{6}\b/);
    if (match) {
      return match[0];
    }

    if (text.includes("NOT_FOUND")) {
      console.warn(`Fund code not found for: ${fundName}`);
    }
    
    return null;
  } catch (e) {
    console.error("Failed to fetch fund code", e);
    return null;
  }
}

export async function fetchFundSector(fundName: string, fundCode?: string): Promise<string | null> {
  if (!fundName && !fundCode) return null;

  let officialName = fundName;
  let fundType = "";

  // 1. Try to get official info from domestic API first (EastMoney/Tiantian)
  // This is a direct domestic connection, very fast even with VPN on.
  try {
    const searchKey = fundCode || fundName;
    const searchUrl = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(searchKey)}&callback=jsonp_callback_sector_search`;
    const parsed = await jsonp(searchUrl, 'jsonp_callback_sector_search', 2000);
    if (parsed && parsed.ErrCode === 0 && parsed.Datas && parsed.Datas.length > 0) {
      const bestMatch = parsed.Datas[0];
      officialName = bestMatch.NAME;
      fundType = bestMatch.TYPE;
    }
  } catch (e) {
    console.warn("Domestic info fetch for sector failed", e);
  }

  try {
    // 2. Use Gemini to categorize based on official info
    // By providing officialName and fundType, Gemini usually doesn't need Google Search,
    // making the response much faster and more accurate.
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `请根据以下基金信息判断其所属的主要投资板块或行业分类：
      名称：${officialName}
      类型：${fundType}
      ${fundCode ? `代码：${fundCode}` : ''}
      
      要求：
      1. 只返回板块名称（如：科技、医疗、消费、宽基、新能源、金融、军工、半导体、白酒等），不要有任何其他文字。
      2. 优先使用最通俗、最常用的分类名称。
      3. 如果是宽基指数（如沪深300、中证500、创业板指），请返回“宽基”。
      4. 如果实在找不到，请返回 "未知"。`,
      config: {
        // We still keep googleSearch as a fallback just in case, 
        // but it will likely not be triggered if the input info is sufficient.
        tools: [{ googleSearch: {} }],
      },
    });
    
    const text = response.text?.trim() || '';
    if (text === "未知" || text.length > 10) {
      return null;
    }
    return text;
  } catch (e) {
    console.error("Failed to fetch fund sector", e);
    return null;
  }
}

export async function fetchFundNAV(fundCode: string): Promise<number | null> {
  try {
    // 1. Try Tiantian Fund API - Direct JSONP (Domestic optimization, bypasses foreign proxy)
    try {
      const ttUrl = `https://fundgz.1234567.com.cn/js/${fundCode}.js?rt=${Date.now()}`;
      const data = await jsonp(ttUrl, 'jsonpgz', 2000);
      if (data && (data.gsz || data.dwjz)) {
        const nav = data.gsz || data.dwjz;
        if (nav && !isNaN(Number(nav))) return Number(nav);
      }
    } catch (e) {
      console.warn("Tiantian direct JSONP failed, trying proxy...", e);
      
      // Fallback to Proxy for Tiantian
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);
        const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://fundgz.1234567.com.cn/js/${fundCode}.js?rt=${Date.now()}`)}`;
        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const data = await res.json();
          if (data && data.contents) {
            const content = data.contents;
            const gszMatch = content.match(/"gsz":"([^"]+)"/);
            const dwjzMatch = content.match(/"dwjz":"([^"]+)"/);
            const nav = gszMatch ? gszMatch[1] : (dwjzMatch ? dwjzMatch[1] : null);
            if (nav && !isNaN(Number(nav))) return Number(nav);
          }
        }
      } catch (proxyErr) {
        console.warn("Tiantian proxy failed", proxyErr);
      }
    }

    // 2. Try Sina Finance API - Direct fetch (Sina often has loose CORS or can be fetched directly)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2000);
      const sinaUrl = `https://hq.sinajs.cn/list=f_${fundCode}`;
      const res = await fetch(sinaUrl, { signal: controller.signal, mode: 'no-cors' }); // no-cors won't let us read body, but let's try standard fetch first
      clearTimeout(timeoutId);
      
      // Since Sina usually requires a proxy for body reading in browser, we mostly rely on proxy here
      // but we use a domestic-friendly approach if possible.
    } catch (e) {}

    // 2.1 Sina via Proxy
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const sinaUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(`https://hq.sinajs.cn/list=f_${fundCode}`)}`;
      const res = await fetch(sinaUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        if (data && data.contents) {
          const matches = [...data.contents.matchAll(/="([^"]+)"/g)];
          for (const match of matches) {
            const parts = match[1].split(',');
            if (parts.length > 1) {
              const nav = parts[1];
              if (nav && !isNaN(Number(nav)) && Number(nav) > 0) return Number(nav);
            }
          }
        }
      }
    } catch (e) {
      console.warn("Sina API failed", e);
    }

    // 3. Try DoctorXiong API (often slow/down, so keep timeout short)
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2500);
      const res = await fetch(`https://api.doctorxiong.club/v1/fund?code=${fundCode}`, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = await res.json();
        if (json.code === 200 && json.data && json.data.length > 0) {
          const nav = json.data[0].expectWorth || json.data[0].netWorth;
          if (nav) return Number(nav);
        }
      }
    } catch (e) {
      console.warn("DoctorXiong API failed", e);
    }

    // 4. Fallback to Gemini with Google Search (Slowest but most reliable)
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: `Search for the latest net asset value (单位净值) or real-time estimated NAV (估算净值) for the Chinese mutual fund with code "${fundCode}". Return ONLY the numeric value as a float (e.g., 1.2345), nothing else.`,
      config: {
        tools: [{ googleSearch: {} }],
      },
    });
    const text = response.text || '';
    const match = text.match(/\d+\.\d{2,4}/);
    if (match) {
      return parseFloat(match[0]);
    }
    return null;
  } catch (e) {
    console.error("Failed to fetch fund NAV", e);
    return null;
  }
}

export async function generateRecap(
  operations: Operation[],
  type: RecapType,
  marketContext: string,
  historySummary?: string
): Promise<{ title: string; content: string }> {
  const prompt = `
    You are a professional financial blogger assistant. 
    Generate a ${type} recap based on the following:
    
    Operations: ${JSON.stringify(operations.map(op => ({
      fundName: op.fundName,
      fundCode: op.fundCode,
      type: op.type,
      amount: op.amount,
      shares: op.shares,
      returnRate: op.returnRate,
      date: op.date,
      reason: op.reason,
      sector: op.sector
    })))}
    Market Context: ${marketContext}
    User History Summary: ${historySummary || "No history yet"}
    
    Style: Professional, clear, engaging for financial social media/blog.
    Language: Chinese.
    
    Output JSON with 'title' and 'content' (Markdown).
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING },
          content: { type: Type.STRING }
        },
        required: ["title", "content"]
      }
    }
  });

  try {
    return JSON.parse(response.text);
  } catch (e) {
    console.error("Failed to parse Gemini response", e);
    throw new Error("Could not generate recap");
  }
}

export async function summarizeHistory(recaps: string[]): Promise<string> {
  const prompt = `Summarize the user's recent investment style and viewpoint evolution based on these recaps: ${recaps.join('\n---\n')}. Return a short paragraph in Chinese.`;
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
  });
  return response.text || "正在积累历史观点...";
}

export async function generateDailyNews(
  holdings: Holding[],
  recentOperations: Operation[]
): Promise<string> {
  const prompt = `
    You are a professional financial analyst and investment advisor. 
    Based on the user's current fund holdings and recent operations, generate a comprehensive "Daily News & Market Insight" (今日快讯与市场洞察) summary.
    
    Current Holdings: ${JSON.stringify(holdings.map(h => ({ name: h.fundName, sector: h.sector })))}
    Recent Operations: ${JSON.stringify(recentOperations.map(o => ({ name: o.fundName, type: o.type, date: o.date })))}
    
    Instructions:
    1. Use the Google Search tool to find the latest (today's) market news in China (A-shares, HK-shares, US-shares if relevant), focusing on the sectors the user is invested in.
    2. Provide a concise "Market Overview" (今日大盘概览) including major indices performance and overall sentiment.
    3. Provide a "Hot Sector Analysis" (热点板块分析) identifying which sectors are leading or lagging today, and why.
    4. Provide "Portfolio Insights" (持仓相关建议) analyzing how today's news affects the user's specific holdings and sectors.
    5. Identify potential "Opportunities & Risks" (机会与风险) for the next few trading days.
    6. Keep the tone professional, objective, and insightful. Use clear headings and bullet points.
    7. Language: Chinese.
    8. Output format: Markdown.
    9. End with: "以上仅为市场观察，不构成投资建议。"
  `;

  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
    },
  });

  return response.text || "暂时无法获取今日快讯，请稍后再试。";
}

