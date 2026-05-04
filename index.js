import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import axios from "axios";

// =====================
// ENV VARIABLES
// =====================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const PROJECT_ID = process.env.PROJECT_ID;
const ALLOWED_CHANNEL_ID = process.env.ALLOWED_CHANNEL_ID; // Add this in Render

// =====================
// SYSTEM PROMPTS
// =====================
const TRIAGE_SYSTEM_PROMPT = `You are an expert software triage assistant.

If the input is a normal question:
→ Answer clearly and concisely.

If the input describes a bug, issue, or request:
→ Return ONLY valid JSON in this format:

{
  "title": "Short clear summary (max 20 words)",
  "description": "Detailed explanation with context, expected vs actual behavior",
  "priority": "low | medium | high",
  "type": "bug | feature | task"
}

Rules:
- NEVER mix JSON and text
- ALWAYS return valid JSON for tickets
- Infer priority correctly:
  high = blocking / login / payment / production issue
  medium = important but workaround exists
  low = minor issue
- Keep title clean and professional`;

const CHAT_SYSTEM_PROMPT = `You are a helpful Discord assistant. Answer questions clearly and concisely. Keep responses under 500 characters.`;

// =====================
// STARTUP LOGS
// =====================
console.log("🚀 Bot starting...");

if (ALLOWED_CHANNEL_ID) {
  console.log(`🔒 Bot will ONLY respond in channel ID: ${ALLOWED_CHANNEL_ID}`);
} else {
  console.log("⚠️ No channel restriction set. Bot will respond in all channels.");
}

// =====================
// DISCORD CLIENT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// =====================
// EXPRESS (Render health check)
// =====================
const app = express();

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    bot: client?.readyAt ? true : false,
    time: new Date().toISOString(),
    restrictedChannel: ALLOWED_CHANNEL_ID || "none"
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Server running on ${PORT}`));

// =====================
// DISCORD READY EVENT
// =====================
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log("✅ Bot is ready");
  
  if (ALLOWED_CHANNEL_ID) {
    console.log(`🔒 Listening only in channel ID: ${ALLOWED_CHANNEL_ID}`);
  }
});

// =====================
// HELPERS
// =====================
async function addToProject(issueNodeId) {
  if (!PROJECT_ID) return false;

  try {
    await axios.post(
      "https://api.github.com/graphql",
      {
        query: `
          mutation AddToProject($projectId: ID!, $contentId: ID!) {
            addProjectV2ItemById(input: {
              projectId: $projectId
              contentId: $contentId
            }) {
              item {
                id
              }
            }
          }
        `,
        variables: {
          projectId: PROJECT_ID,
          contentId: issueNodeId
        }
      },
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          "Content-Type": "application/json"
        }
      }
    );

    return true;
  } catch (err) {
    console.log("❌ Project error:", err.response?.data || err.message);
    return false;
  }
}

// =====================
// MESSAGE HANDLER
// =====================
client.on("messageCreate", async (message) => {
  // Ignore bot's own messages
  if (message.author.bot) return;

  // =====================
  // CHANNEL RESTRICTION
  // =====================
  // Only respond in the allowed channel (if specified)
  if (ALLOWED_CHANNEL_ID && message.channel.id !== ALLOWED_CHANNEL_ID) {
    console.log(`⏭️ Ignoring message in ${message.channel.name || message.channel.id} - not allowed channel`);
    return; // Exit without responding
  }

  const text = message.content;
  console.log(`📩 [${message.author.tag}] in #${message.channel.name}: ${text.substring(0, 50)}${text.length > 50 ? "..." : ""}`);

  try {
    // =====================
    // PING COMMAND
    // =====================
    if (text === "!ping") {
      await message.reply(`🏓 Pong! Bot is alive (Latency: ${Date.now() - message.createdTimestamp}ms)`);
      return;
    }

    // =====================
    // TICKET FLOW (!ticket)
    // =====================
    if (text.startsWith("!ticket")) {
      const issueText = text.replace("!ticket", "").trim();

      if (!issueText) {
        await message.reply("⚠️ Please provide ticket details.\nExample: `!ticket Login button is broken on mobile`");
        return;
      }

      console.log("🎫 Ticket request:", issueText);

      // Check GitHub credentials
      if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        await message.reply("❌ GitHub not configured. Contact admin.");
        return;
      }

      try {
        await message.channel.sendTyping();

        // Call Groq to format the ticket using the triage prompt
        const aiRes = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: "llama-3.1-8b-instant",
            messages: [
              {
                role: "system",
                content: TRIAGE_SYSTEM_PROMPT
              },
              {
                role: "user",
                content: issueText
              }
            ],
            max_tokens: 500,
            temperature: 0.3
          },
          {
            headers: {
              Authorization: `Bearer ${GROQ_API_KEY}`,
              "Content-Type": "application/json"
            },
            timeout: 15000
          }
        );

        const groqResponse = aiRes.data?.choices?.[0]?.message?.content;
        console.log("📝 Groq response:", groqResponse);

        // Parse JSON response
        let ticketData;
        try {
          let cleanResponse = groqResponse.replace(/```json\n?/g, '').replace(/```\n?/g, '');
          ticketData = JSON.parse(cleanResponse);
        } catch (e) {
          ticketData = {
            title: issueText.slice(0, 50),
            description: issueText,
            priority: "medium",
            type: "bug"
          };
        }

        // Create GitHub issue with formatted data
        const issueRes = await axios.post(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
          {
            title: `[${ticketData.priority.toUpperCase()}] ${ticketData.title}`,
            body: `**Reported by:** ${message.author.tag} (${message.author.id})\n\n` +
                  `**Priority:** ${ticketData.priority}\n` +
                  `**Type:** ${ticketData.type}\n\n` +
                  `---\n\n` +
                  `${ticketData.description}`,
            labels: [ticketData.type, `priority-${ticketData.priority}`, "from-discord"]
          },
          {
            headers: {
              Authorization: `Bearer ${GITHUB_TOKEN}`,
              Accept: "application/vnd.github+json"
            }
          }
        );

        const issueUrl = issueRes.data.html_url;
        const issueNumber = issueRes.data.number;
        const issueNodeId = issueRes.data.node_id;

        console.log(`✅ Issue #${issueNumber} created: ${issueUrl}`);

        // Add to project board if configured
        const added = await addToProject(issueNodeId);

        await message.reply(
          `✅ **GitHub Ticket Created!**\n\n` +
          `**Title:** ${ticketData.title}\n` +
          `**Priority:** ${ticketData.priority}\n` +
          `**Type:** ${ticketData.type}\n` +
          `**Issue:** #${issueNumber}\n` +
          `**URL:** ${issueUrl}${added ? "\n📌 Added to project board" : ""}`
        );

      } catch (error) {
        console.error("❌ Ticket error:", error.response?.data || error.message);
        await message.reply("❌ Failed to create ticket. Please try again later.");
      }
      return;
    }

    // =====================
    // AI CHAT (Normal Questions)
    // =====================
    if (!text.startsWith("!")) {
      if (!GROQ_API_KEY) {
        await message.reply("⚠️ AI not configured");
        return;
      }

      console.log("🤖 AI Chat:", text.substring(0, 50));

      try {
        await message.channel.sendTyping();

        const aiRes = await axios.post(
          "https://api.groq.com/openai/v1/chat/completions",
          {
            model: "llama-3.1-8b-instant",
            messages: [
              {
                role: "system",
                content: CHAT_SYSTEM_PROMPT
              },
              {
                role: "user",
                content: text
              }
            ],
            max_tokens: 500,
            temperature: 0.7
          },
          {
            headers: {
              Authorization: `Bearer ${GROQ_API_KEY}`,
              "Content-Type": "application/json"
            },
            timeout: 15000
          }
        );

        const reply = aiRes.data?.choices?.[0]?.message?.content || "No response";
        
        if (reply.length > 1900) {
          const chunks = reply.match(/.{1,1900}/g);
          await message.reply(chunks[0]);
          for (let i = 1; i < chunks.length; i++) {
            await message.channel.send(chunks[i]);
          }
        } else {
          await message.reply(reply);
        }

      } catch (error) {
        console.error("❌ AI error:", error.response?.data || error.message);
        await message.reply("⚠️ AI service error. Please try again later.");
      }
      return;
    }
  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    await message.reply("⚠️ Something went wrong. Check logs.");
  }
});

// =====================
// START BOT
// =====================
client.login(DISCORD_TOKEN);
