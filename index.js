import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import axios from "axios";

// =====================
// ENVIRONMENT VALIDATION
// =====================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const PROJECT_ID = process.env.PROJECT_ID;

// Validate required variables
if (!DISCORD_TOKEN) {
  console.error("❌ DISCORD_TOKEN is required");
  process.exit(1);
}

console.log("✅ Environment loaded:", {
  discord: !!DISCORD_TOKEN,
  groq: !!GROQ_API_KEY,
  github: !!GITHUB_TOKEN,
  project: !!PROJECT_ID,
  repo: `${GITHUB_OWNER}/${GITHUB_REPO}`
});

// =====================
// EXPRESS SERVER (for Render health checks)
// =====================
const app = express();

app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    bot: client?.isReady?.() || false,
    timestamp: new Date().toISOString()
  });
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "healthy", 
    bot: client?.isReady?.() || false 
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Health server running on port ${PORT}`));

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

// ✅ FIXED: 'ready' not 'clientReady'
client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`📡 Bot is in ${client.guilds.cache.size} servers`);
});

// =====================
// HELPER FUNCTIONS
// =====================
async function addIssueToProject(issueNodeId) {
  if (!PROJECT_ID || !PROJECT_ID.startsWith('PVT_')) {
    console.log("⚠️ No valid PROJECT_ID provided, skipping project assignment");
    return false;
  }

  try {
    const response = await axios.post(
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
    
    console.log("✅ Issue added to project board");
    return true;
  } catch (error) {
    console.error("❌ Failed to add to project:", error.response?.data || error.message);
    return false;
  }
}

// =====================
// MESSAGE HANDLER
// =====================
client.on("messageCreate", async (message) => {
  // Ignore bot's own messages
  if (message.author.bot) return;

  const text = message.content;
  console.log(`📩 ${message.author.tag}: ${text.substring(0, 50)}`);

  try {
    // =====================
    // TICKET FLOW (!ticket)
    // =====================
    if (text.startsWith("!ticket")) {
      const issueText = text.replace("!ticket", "").trim();

      if (!issueText) {
        await message.reply(
          "⚠️ Please provide ticket details.\n" +
          "Example: `!ticket Login button is broken on mobile`"
        );
        return;
      }

      console.log("🎫 Creating ticket:", issueText);

      // Check GitHub credentials
      if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        await message.reply("❌ GitHub not configured. Please contact server admin.");
        return;
      }

      try {
        // Step 1: Create GitHub Issue
        const issueRes = await axios.post(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
          {
            title: `[Discord] ${issueText.slice(0, 60)}`,
            body: `**Reported by:** ${message.author.tag} (${message.author.id})\n\n**Issue:**\n${issueText}`,
            labels: ["from-discord", "auto-generated"]
          },
          {
            headers: {
              Authorization: `Bearer ${GITHUB_TOKEN}`,
              Accept: "application/vnd.github.v3+json"
            }
          }
        );

        const issueUrl = issueRes.data.html_url;
        const issueNodeId = issueRes.data.node_id;
        const issueNumber = issueRes.data.number;

        console.log(`✅ Issue #${issueNumber} created: ${issueUrl}`);

        // Step 2: Add to Project Board (if Project ID provided)
        let projectAdded = false;
        if (PROJECT_ID) {
          projectAdded = await addIssueToProject(issueNodeId);
        }

        // Step 3: Send confirmation to Discord
        const projectMessage = projectAdded ? "\n✅ Added to project board" : "";
        await message.reply(
          `✅ **GitHub Ticket Created!**\n\n` +
          `**Issue:** #${issueNumber}\n` +
          `**URL:** ${issueUrl}${projectMessage}`
        );
        
      } catch (githubError) {
        console.error("❌ GitHub Error:", githubError.response?.data || githubError.message);
        
        if (githubError.response?.status === 401) {
          await message.reply("❌ GitHub authentication failed. Please check GITHUB_TOKEN.");
        } else if (githubError.response?.status === 404) {
          await message.reply("❌ Repository not found. Check GITHUB_OWNER and GITHUB_REPO.");
        } else {
          await message.reply("❌ Failed to create GitHub ticket. Please try again later.");
        }
      }
      return;
    }

    // =====================
    // AI CHAT FLOW (GROQ)
    // =====================
    if (!GROQ_API_KEY) {
      await message.reply("💡 AI chat is not configured yet. Contact server admin.");
      return;
    }

    console.log("🤖 Asking Groq AI...");
    
    const aiRes = await axios.post(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        model: "llama3-8b-8192",
        messages: [
          {
            role: "system",
            content: "You are a helpful Discord assistant. Answer questions concisely and warmly. Keep responses under 500 characters."
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
        }
      }
    );

    const reply = aiRes.data?.choices?.[0]?.message?.content || "No response from AI";
    await message.reply(reply);
    console.log(`✅ Replied to ${message.author.tag}`);

  } catch (error) {
    console.error("❌ Error:", error.response?.data || error.message);
    
    // User-friendly error messages
    let userMessage = "⚠️ Error processing your request. Please try again later.";
    
    if (error.response?.status === 401) {
      userMessage = "🔑 API key error. Please contact admin.";
    } else if (error.response?.status === 429) {
      userMessage = "⏰ Too many requests. Please wait a moment and try again.";
    } else if (error.code === 'ECONNREFUSED') {
      userMessage = "🌐 Connection error. Please try again in a few seconds.";
    }
    
    await message.reply(userMessage);
  }
});

// =====================
// ERROR HANDLING
// =====================
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error);
});

// =====================
// START BOT
// =====================
client.login(DISCORD_TOKEN);
