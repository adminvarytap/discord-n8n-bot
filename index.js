import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import axios from "axios";

// =====================
// EXPRESS SERVER (Render requirement)
// =====================
const app = express();

app.get("/", (req, res) => {
  res.send("✅ Bot is running");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🌐 Web server running on port ${PORT}`);
});

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

const TOKEN = process.env.DISCORD_TOKEN;
const N8N_WEBHOOK = process.env.N8N_WEBHOOK;

client.once("ready", () => {
  console.log(`🤖 Bot logged in as ${client.user.tag}`);
});

// =====================
// MESSAGE HANDLER
// =====================
client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    console.log("📩 Message:", message.content);

    // Send message to n8n
    const res = await axios.post(N8N_WEBHOOK, {
      content: message.content,
      username: message.author.username,
      userId: message.author.id,
      channelId: message.channelId
    });

    const reply = res.data?.reply;

    if (reply) {
      await message.reply(reply);
    } else {
      await message.reply("⚠️ No response from workflow");
    }

  } catch (error) {
    console.error("❌ Error:", error.message);
    await message.reply("⚠️ Something went wrong");
  }
});

// =====================
// START BOT
// =====================
client.login(TOKEN);
