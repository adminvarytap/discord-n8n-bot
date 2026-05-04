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
// EXPRESS (Render health check)
// =====================
const app = express();

app.get("/", (req, res) => {
  res.send("🤖 Discord Bot is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));

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

client.once("clientReady", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// =====================
// MAIN MESSAGE HANDLER
// =====================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const text = message.content;

  try {
    // =========================
    // 1. TICKET FLOW
    // =========================
    if (text.startsWith("!ticket")) {
      const issueText = text.replace("!ticket", "").trim();

      if (!issueText) {
        await message.reply("⚠️ Please describe the issue.");
        return;
      }

      // 1. Create GitHub Issue
      const issueRes = await axios.post(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
        {
          title: `[TICKET] ${issueText.slice(0, 60)}`,
          body: issueText
        },
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json"
          }
        }
      );

      const issueNodeId = issueRes.data.node_id;

      // 2. Add Issue to GitHub Project (V2)
      await axios.post(
        "https://api.github.com/graphql",
        {
          query: `
            mutation {
              addProjectV2ItemById(input: {
                projectId: "${PROJECT_ID}",
                contentId: "${issueNodeId}"
              }) {
                item {
                  id
                }
              }
            }
          `
        },
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            "Content-Type": "application/json"
          }
        }
      );

      await message.reply("📝 Ticket created and added to project board!");
      return;
    }

    // =========================
    // 2. AI CHAT (GROQ)
    // =========================
    const aiRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content: "You are a helpful assistant for a SaaS support system."
          },
          {
            role: "user",
            content: text
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    const reply =
      aiRes.data?.choices?.[0]?.message?.content || "No response";

    await message.reply(reply);

  } catch (err) {
    console.error("❌ Error:", err.response?.data || err.message);
    await message.reply("⚠️ Error processing request");
  }
});

// =====================
client.login(DISCORD_TOKEN);
