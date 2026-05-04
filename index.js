import { Client, GatewayIntentBits } from "discord.js";
import axios from "axios";

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
  console.log(`Bot running as ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  try {
    const res = await axios.post(N8N_WEBHOOK, {
      content: message.content,
      username: message.author.username,
      channelId: message.channelId
    });

    if (res.data.reply) {
      await message.reply(res.data.reply);
    }

  } catch (err) {
    console.error(err.message);
    message.reply("Error processing request");
  }
});

client.login(TOKEN);