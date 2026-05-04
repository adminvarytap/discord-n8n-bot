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

// =====================
// STARTUP LOGS
// =====================
console.log("🚀 Bot starting...");

// =====================
// DISCORD CLIENT (MOVE BEFORE EXPRESS)
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
    bot: client?.readyAt ? true : false,  // ✅ Now client exists
    time: new Date().toISOString()
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
  if (message.author.bot) return;

  const text = message.content;

  try {
    // =====================
    // TICKET FLOW
    // =====================
    if (text.startsWith("!ticket")) {
      const issueText = text.replace("!ticket", "").trim();

      if (!issueText) {
        await message.reply("⚠️ Please provide ticket details.");
        return;
      }

      console.log("🎫 Ticket:", issueText);

      // Check GitHub credentials
      if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        await message.reply("❌ GitHub not configured.");
        return;
      }

      // 1. Create GitHub Issue
      const issueRes = await axios.post(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
        {
          title: `[TICKET] ${issueText.slice(0, 60)}`,
          body: `**Reported by:** ${message.author.tag}\n\n${issueText}`,
          labels: ["from-discord"]
        },
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json"
          }
        }
      );

      const issueUrl = issueRes.data.html_url;
      const issueNodeId = issueRes.data.node_id;

      // 2. Add to Project (optional)
      const added = await addToProject(issueNodeId);

      await message.reply(
        `✅ **Ticket created!**\n${issueUrl}${added ? "\n📌 Added to project board" : ""}`
      );
      return;
    }

    // =====================
    // AI CHAT (GROQ)
    // =====================
    if (!text.startsWith("!")) {
      if (!GROQ_API_KEY) {
        await message.reply("⚠️ AI not configured");
        return;
      }

      console.log("🤖 Asking Groq:", text.substring(0, 50));

      const aiRes = await axios.post(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          model: "llama-3.1-8b-instant",
          messages: [
            {
              role: "system",
              content: "You are a helpful Discord assistant. Answer concisely and warmly."
            },
            {
              role: "user",
              content: text
            }
          ],
          max_tokens: 400,
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
      
      await message.reply(reply);
      return;
    }
  } catch (err) {
    console.error("❌ ERROR:", err.response?.data || err.message);
    await message.reply("⚠️ Something went wrong. Check logs.");
  }
});

// =====================
// START BOT
// =====================
client.login(DISCORD_TOKEN);
