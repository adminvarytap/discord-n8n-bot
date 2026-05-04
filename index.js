import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import axios from "axios";

// =====================
// EXPRESS (Render requirement)
// =====================
const app = express();
app.get("/", (req, res) => res.send("Bot is running"));
app.listen(process.env.PORT || 3000);

// =====================
// CONFIG
// =====================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;

// =====================
// DISCORD BOT
// =====================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
});

// =====================
// HANDLE MESSAGE
// =====================
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const text = message.content;

  try {
    // =====================
    // TICKET FLOW
    // =====================
    if (text.startsWith("!ticket ")) {
      const issue = text.replace("!ticket ", "");

      // Create GitHub issue
      await axios.post(
        `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
        {
          title: `[BUG] ${issue}`,
          body: `
User: ${message.author.username}

Issue:
${issue}

Source: Discord bot
          `
        },
        {
          headers: {
            Authorization: `Bearer ${GITHUB_TOKEN}`,
            Accept: "application/vnd.github+json"
          }
        }
      );

      await message.reply("📝 Ticket created in GitHub!");
      return;
    }

    // =====================
    // AI RESPONSE (Groq)
    // =====================
    const aiRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama-3.1-8b-instant",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant. Answer clearly and concisely."
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
    console.error(err.response?.data || err.message);
    await message.reply("⚠️ Error processing request");
  }
});

// =====================
client.login(DISCORD_TOKEN);
