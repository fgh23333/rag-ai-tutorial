/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */
import { Hono } from "hono";
const app = new Hono();

// 设置 Rate Limit 中间件
const rateLimitMiddleware = async (c, next) => {
	// 配置每分钟的最大请求次数和时间窗口
	const maxRequests = 120;  // 每分钟最多请求次数
	const timeWindow = 60;   // 限制时间窗口（秒）

	// 生成一个独特的 key，假设通过接口 URL 来标识速率限制的范围
	const limitKey = `rate_limit_${c.req.path}`;  // 使用接口 URL 作为限流的 key

	// 获取 KV 中的当前请求记录
	let requestCount = await c.env.RATE_LIMIT_KV.get(limitKey, 'json');

	// 如果没有记录，则初始化
	if (!requestCount) {
		requestCount = { count: 0, timestamp: Math.floor(Date.now() / 1000) };  // 初始化计数和时间戳
	}

	const currentTime = Math.floor(Date.now() / 1000);

	// 如果请求在限制时间窗口内
	if (currentTime - requestCount.timestamp < timeWindow) {
		// 如果超过最大请求次数，限制访问
		if (requestCount.count >= maxRequests) {
			return c.text('Rate limit exceeded. Please try again later.', 429);
		}

		// 否则，增加请求次数
		requestCount.count++;
	} else {
		// 如果时间窗口已过，重置计数和时间戳
		requestCount = { count: 1, timestamp: currentTime };
	}

	// 更新 KV 中的请求记录
	await c.env.RATE_LIMIT_KV.put(limitKey, JSON.stringify(requestCount), {
		expirationTtl: timeWindow,  // 设置 KV 数据过期时间（以秒为单位）
	});

	// 继续处理请求
	await next();
};

app.use("*", async (c, next) => {
	const origin = c.req.header("Origin");

	// 允许的域名列表
	const allowedOrigins = [
		/^https:\/\/([a-zA-Z0-9-]+)\.635262140\.xyz$/, // 允许 *.example.com
		/^http:\/\/localhost(:\d+)?$/, // 允许本地调试，支持 localhost:5173
	];

	// 检查是否匹配
	if (origin && allowedOrigins.some((regex) => regex.test(origin))) {
		c.header("Access-Control-Allow-Origin", origin); // 允许匹配的来源
		c.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
		c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
		c.header("Access-Control-Allow-Credentials", "true"); // 允许携带凭据
	}

	// 处理 OPTIONS 预检请求，直接返回 204
	if (c.req.method === "OPTIONS") {
		return c.text(null, 204);
	}

	return next();
});

// app.get('/', rateLimitMiddleware, async (c) => {
// 	const question = c.req.query('text') || "What is the square root of 9?"

// 	const embeddings = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: question })
// 	const vectors = embeddings.data[0]

// 	const vectorQuery = await c.env.VECTOR_INDEX.query(vectors, { topK: 1 });
// 	let vecId;
// 	if (vectorQuery.matches && vectorQuery.matches.length > 0 && vectorQuery.matches[0]) {
// 		vecId = vectorQuery.matches[0].id;
// 	} else {
// 		console.log("No matching vector found or vectorQuery.matches is empty");
// 	}

// 	let notes = []
// 	if (vecId) {
// 		const query = `SELECT * FROM notes WHERE id = ?`
// 		const { results } = await c.env.DB.prepare(query).bind(vecId).all()
// 		if (results) notes = results.map(vec => vec.text)
// 	}

// 	const contextMessage = notes.length
// 		? `Context:\n${notes.map(note => `- ${note}`).join("\n")}`
// 		: ""

// 	const systemPrompt = `When answering the question or responding, use the context provided, if it is provided and relevant.`

// 	let modelUsed = ""
// 	let response = null

// 	const model = "@cf/meta/llama-3.1-8b-instruct"
// 	modelUsed = model

// 	response = await c.env.AI.run(
// 		model,
// 		{
// 			messages: [
// 				...(notes.length ? [{ role: 'system', content: contextMessage }] : []),
// 				{ role: 'system', content: systemPrompt },
// 				{ role: 'user', content: question }
// 			]
// 		}
// 	)

// 	if (response) {
// 		c.header('x-model-used', modelUsed)
// 		return c.text(response.response)
// 	} else {
// 		return c.text("We were unable to generate output", 500)
// 	}
// });

app.onError((err, c) => {
	return c.text(err);
});

// app.post("/rag", rateLimitMiddleware, async (c) => {
// 	const { query } = await c.req.json();
// 	if (!query) return c.json({ error: "❌ 缺少 query 参数" }, 400);

// 	const logKey = `request_log_${Date.now()}`; // 唯一日志 key

// 	// 💾 记录日志
// 	let logData = { timestamp: new Date().toISOString(), query };

// 	// 📖 1. 生成向量 Embedding
// 	const embeddings = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", { text: query });

// 	// 🔍 2. 检索相关文档
// 	const MIN_SIMILARITY_SCORE = 0.7; // 设置最低匹配度阈值
// 	const retrievedDocs = await c.env.VECTOR_INDEX.query(embeddings.data[0], { topK: 5, returnMetadata: "all" });

// 	// 过滤低匹配度的结果
// 	const highQualityDocs = retrievedDocs.matches.filter(doc => doc.score >= MIN_SIMILARITY_SCORE);

// 	let answers = [];
// 	let sources = [];

// 	if (highQualityDocs.length > 0) {
// 		// ✅ 3. RAG 生成回答
// 		for (const doc of highQualityDocs) {
// 			const answer = await c.env.AI.run("@cf/google/gemma-2b-it-lora", {
// 				prompt: `问题: ${query}\n\n背景知识: ${doc.metadata.text}\n\n请基于以上信息回答问题:`,
// 				temperature: 0.7,
// 			});
// 			answers.push(answer.response);
// 			sources.push(`主题: ${doc.namespace}, 内容: ${doc.metadata.text}`);
// 		}
// 	} else {
// 		// ❌ 低匹配度，直接调用 LLM 生成答案
// 		console.log("⚠️ 匹配度过低，直接调用 Gemma 生成回答");
// 		const llmAnswer = await c.env.AI.run("@cf/google/gemma-2b-it-lora", {
// 			prompt: `问题: ${query}\n\n未在知识库中找到相关内容，请基于已有知识合理推测并回答:`,
// 			temperature: 0.7,
// 		});
// 		answers.push(llmAnswer.response);
// 		sources.push("⚠️ 未找到相关文档，答案由 AI 推测");
// 	}

// 	// 💾 4. 存入 KV
// 	const result = { answers, sources };
// 	logData.result = result; // 将结果添加到日志数据中
// 	await c.env.REQUEST_LOG_KV.put(logKey, JSON.stringify(logData));

// 	// ✅ 5. 发送结果
// 	return c.json(result);
// });

// app.post("/rag", rateLimitMiddleware, async (c) => {
// 	const { query } = await c.req.json();
// 	const { subject } = await c.req.json();
// 	if (!query) return c.json({ error: "❌ 缺少 query 参数" }, 400);

// 	const logKey = `request_log_${Date.now()}`;

// 	// ✅ 记录日志
// 	let logData = { timestamp: new Date().toISOString(), query };

// 	// ✅ 生成向量 Embedding
// 	const embeddings = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", { text: query });

// 	// ✅ 检索相关文档
// 	const MIN_SIMILARITY_SCORE = 0.7;

// 	let queryOptions = {
// 		topK: 5,
// 		returnMetadata: "all"
// 	};

// 	if (subject && subject !== "default") {
// 		queryOptions.namespace = subject;
// 	}

// 	const retrievedDocs = await c.env.VECTOR_INDEX.query(embeddings.data[0], queryOptions);
// 	console.log("检索到的文档:", retrievedDocs);

// 	const highQualityDocs = retrievedDocs.matches.filter(doc => doc.score >= MIN_SIMILARITY_SCORE);

// 	let promptContext = "";
// 	let sources = [];

// 	if (highQualityDocs.length > 0) {
// 		console.log("✅ 匹配到高质量文档，结合文档生成 Prompt");
// 		for (const doc of highQualityDocs) {
// 			sources.push(`主题: ${doc.namespace}, 内容: ${doc.metadata.text}`);
// 		}
// 		promptContext = sources.join("\n\n");
// 	} else {
// 		sources = []
// 		console.log("⚠️ 匹配度过低，将直接使用 LLM 生成 Prompt");
// 	}

// 	// ✅ 调用大模型 **生成 Prompt**
// 	const generatedPrompt = await c.env.AI.run("@cf/google/gemma-2b-it-lora", {
// 		prompt: `
// 你是一个智能 Prompt 生成器，任务是为 AI 生成高质量的 Prompt，使其能够回答用户问题。  

// **用户问题:**  
// ${query}  

// **背景知识:**  
// ${promptContext || "⚠️ 未找到相关文档，请基于用户问题生成合适的 Prompt"}  

// **生成规则:**  
// 1. 若有背景知识，**优先基于背景知识构造问题**  
// 2. 若无背景知识，**使用你的知识生成高质量 Prompt**  
// 3. **使 Prompt 逻辑清晰，结构化，并让 AI 详细回答**  
// 4. **避免 AI 拒答，尽可能提供合理推测**  

// **最终 Prompt:**  
// `,
// 		temperature: 0.3, // 低温度，提高稳定性
// 	});

// 	const finalPrompt = generatedPrompt.response;
// 	console.log("✅ 生成的 Prompt:", finalPrompt);

// 	// ✅ 调用目标模型，生成最终回答
// 	const answer = await c.env.AI.run("@cf/google/gemma-2b-it-lora", {
// 		prompt: finalPrompt,
// 		temperature: 0.7,
// 	});

// 	// ✅ 缓存结果
// 	const result = { answer: answer.response, sources };
// 	logData.result = result; // 将结果添加到日志数据中
// 	await c.env.REQUEST_LOG_KV.put(logKey, JSON.stringify(logData));

// 	return c.json(result);
// });

// app.post("/embed", async (c) => {
// 	try {
// 		const documents = await c.req.json();

// 		const texts = documents.map(doc => doc.text);

// 		// 向量化
// 		const vectors = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: texts });

// 		// 组合数据
// 		const responseData = documents.map((doc, index) => ({
// 			subject: doc.subject,
// 			text: doc.text,
// 			vector: vectors.data[index],
// 		}));

// 		return c.json({ success: true, data: responseData });
// 	} catch (error) {
// 		return c.json({ error: error.message }, 500);
// 	}
// });

app.post("/rag", rateLimitMiddleware, async (c) => {
	const { query } = await c.req.json();
	const { subject } = await c.req.json();
	if (!query) return c.json({ error: "❌ 缺少 query 参数" }, 400);

	const logKey = `request_log_${Date.now()}`;

	// ✅ 记录日志
	let logData = { timestamp: new Date().toISOString(), query };

	// ✅ 生成向量 Embedding
	const embeddings = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", { text: query });

	// ✅ 检索相关文档
	const MIN_SIMILARITY_SCORE = 0.7;
	let queryOptions = {
		topK: 5,  // 限制检索数量，避免无关文档过多
		returnMetadata: "all"
	};

	if (subject && subject !== "default") {
		queryOptions.namespace = subject;
	}

	// 执行检索
	const retrievedDocs = await c.env.VECTOR_INDEX.query(embeddings.data[0], queryOptions);
	console.log("检索到的文档:", retrievedDocs);

	// 过滤并排序文档
	const highQualityDocs = retrievedDocs.matches
		.filter(doc => doc.score >= MIN_SIMILARITY_SCORE) // 只保留相似度高的文档
		.map(doc => ({
			...doc,
			textMatchScore: query.split("").reduce((score, word) => {
				return score + (doc.metadata.text.includes(word) ? 1 : 0);
			}, 0)
		}))
		.sort((a, b) => (b.score + b.textMatchScore) - (a.score + a.textMatchScore)) // 排序文档
		.filter(doc => doc.textMatchScore > 0) // 去除无关文档
		.slice(0, 5); // 只保留前三个相关文档

	let promptContext = "";
	let sources = [];

	if (highQualityDocs.length > 0) {
		console.log("✅ 匹配到高质量文档，结合文档生成 Prompt");
		for (const doc of highQualityDocs) {
			sources.push(`主题: ${doc.namespace}, 内容: ${doc.metadata.text}`);
		}
		promptContext = sources.join("\n\n");
	} else {
		sources = [];
		console.log("⚠️ 匹配度过低，将直接使用 LLM 生成 Prompt");
		promptContext = "⚠️ 没有检索到相关文档，请基于用户问题生成合适的 Prompt";
	}

	// ✅ 调用大模型 **生成 Prompt**
	const generatedPrompt = await c.env.AI.run("@cf/google/gemma-2b-it-lora", {
		prompt: `
  你是一个智能 Prompt 生成器，任务是为 AI 生成高质量的 Prompt，使其能够回答用户问题。  
  
  **用户问题:**  
  ${query}  
  
  **背景知识:**  
  ${promptContext}  
  
  **生成规则:**  
  1. 若有背景知识，**优先基于背景知识构造问题**  
  2. 若无背景知识，**直接生成高质量 Prompt**  
  3. **使 Prompt 逻辑清晰，结构化，并让 AI 详细回答**  
  4. **避免 AI 拒答，尽可能提供合理推测**  
  5. **你是一个单次问答模型，不能在回答中反问用户**
  6. **避免使用“我不知道”或“我无法回答”这样的措辞**
  7. **避免使用“你能否”这样的措辞**
  8. **避免提示用户继续输入**
  9. **避免生成多条式的 Prompt**
  10 **你生成的是要给 AI 的 Prompt，而不是直接回答**
  
  **最终 Prompt:**  
  `,
		temperature: 0.3, // 低温度，提高稳定性
		max_tokens: 4096, // 限制最大输出长度
	});

	const finalPrompt = generatedPrompt.response;
	console.log("✅ 生成的 Prompt:", finalPrompt);

	// ✅ 调用目标模型，生成最终回答
	const answer = await c.env.AI.run("@cf/google/gemma-3-12b-it", {
		prompt: finalPrompt,
		temperature: 0.7,
		top_p: 0.9,
		max_tokens: 16384, // 限制最大输出长度
	});

	// ✅ 缓存结果
	const result = { answer: answer.response, sources };
	logData.result = result; // 将结果添加到日志数据中
	await c.env.REQUEST_LOG_KV.put(logKey, JSON.stringify(logData));

	return c.json(result);
});

app.post("/retrieve", async (c) => {
	const { query } = await c.req.json();
	if (!query) return c.json({ error: "❌ 缺少 query 参数" }, 400);

	const embeddings = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", { text: query });

	const MIN_SIMILARITY_SCORE = 0.5;
	const retrievedDocs = await c.env.VECTOR_INDEX.query(embeddings.data[0], { topK: 5, returnMetadata: "all" });

	const highQualityDocs = retrievedDocs.matches.filter(doc => doc.score >= MIN_SIMILARITY_SCORE);

	let sources = [];

	if (highQualityDocs.length > 0) {
		for (const doc of highQualityDocs) {
			sources.push(doc);
		}
	} else {
		sources = [];
	}

	return c.json({
		status: "success",
		data: sources
	});
});

app.post("/insert", async (c) => {
	const body = await c.req.json();
	const batch = body.batch

	try {
		// 处理批量插入
		const items = batch.map((doc) => ({
			id: doc.id.toString(), // 文档 ID
			values: doc.values,  // 768 维向量
			metadata: { text: doc.text }, // 额外元数据
			namespace: doc.subject
		}));

		// 存入 Cloudflare Vectorize
		await c.env.VECTOR_INDEX.upsert(items);

		return c.json({ success: true, count: items.length });
	} catch (err) {
		return c.json({ error: "Failed to insert data", details: err.message }, 500);
	}
});

app.post("/set", async (c) => {
	const body = await c.req.json();
	const key = body.key
	const value = body.value

	try {
		let texts = [];
		texts.push(value);
		const vector = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", { text: texts });

		const itemInfo = {
			id: key,
			values: vector.data[0],
			metadata: { text: value },
			namespace: "siteInfo"
		};

		let items = [];
		items.push(itemInfo);

		await c.env.VECTOR_INDEX.upsert(items);
		return c.json({ success: true, count: items.length });
	} catch (error) {
		return c.json({ error: error.message }, 500);
	}
});

export default app;
