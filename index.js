import express from "express";
import { Client, GatewayIntentBits } from "discord.js";
import axios from "axios";

// =====================
// ENVIRONMENT VARIABLES
// =====================
const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_OWNER = process.env.GITHUB_OWNER;
const GITHUB_REPO = process.env.GITHUB_REPO;
const PROJECT_ID = process.env.PROJECT_ID;

// =====================
// STARTUP VALIDATION
// =====================
console.log("🚀 Starting Discord Bot...");
console.log("═".repeat(50));

const missingVars = [];
if (!DISCORD_TOKEN) missingVars.push("DISCORD_TOKEN");
if (!GROQ_API_KEY) missingVars.push("GROQ_API_KEY (AI disabled)");
if (!GITHUB_TOKEN) missingVars.push("GITHUB_TOKEN (GitHub disabled)");
if (!GITHUB_OWNER) missingVars.push("GITHUB_OWNER");
if (!GITHUB_REPO) missingVars.push("GITHUB_REPO");

if (missingVars.length > 0) {
  console.log("⚠️ Missing environment variables:");
  missingVars.forEach(v => console.log(`   - ${v}`));
}

console.log(`📁 GitHub Repo: ${GITHUB_OWNER && GITHUB_REPO ? `${GITHUB_OWNER}/${GITHUB_REPO}` : "Not configured"}`);
console.log(`🤖 Groq AI: ${GROQ_API_KEY ? "✅ Enabled" : "❌ Disabled"}`);
console.log(`📋 GitHub Project: ${PROJECT_ID ? "✅ Configured" : "❌ Not configured"}`);
console.log("═".repeat(50));

// =====================
// EXPRESS SERVER (for Render health checks)
// =====================
const app = express();

app.get("/", (req, res) => {
  res.json({ 
    status: "ok", 
    bot: client?.isReady?.() || false,
    timestamp: new Date().toISOString(),
    github: `${GITHUB_OWNER}/${GITHUB_REPO}`,
    ai: !!GROQ_API_KEY
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

client.once("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`📡 Bot is in ${client.guilds.cache.size} servers`);
  console.log("═".repeat(50));
  console.log("✅ Bot is ready and listening for messages!");
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
  console.log(`📩 [${message.author.tag}]: ${text.substring(0, 50)}${text.length > 50 ? "..." : ""}`);

  try {
    // =====================
    // TEST COMMANDS
    // =====================
    if (text === "!ping") {
      await message.reply(`🏓 Pong! Bot is alive (Latency: ${Date.now() - message.createdTimestamp}ms)`);
      return;
    }

    if (text === "!config") {
      await message.reply(
        `📋 **Bot Configuration**\n\n` +
        `**GitHub:** ${GITHUB_TOKEN ? "✅" : "❌"} ${GITHUB_OWNER}/${GITHUB_REPO}\n` +
        `**Groq AI:** ${GROQ_API_KEY ? "✅" : "❌"}\n` +
        `**Project Board:** ${PROJECT_ID ? "✅" : "❌"}\n\n` +
        `**Commands:**\n` +
        `• \`!ping\` - Check if bot is alive\n` +
        `• \`!config\` - Show this config\n` +
        `• \`!ticket [message]\` - Create GitHub issue\n` +
        `• Any question - AI will answer`
      );
      return;
    }

    if (text === "!github") {
      if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        await message.reply("❌ GitHub not configured. Missing variables.");
        return;
      }
      
      try {
        const test = await axios.get(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}`,
          { headers: { Authorization: `Bearer ${GITHUB_TOKEN}` } }
        );
        
        await message.reply(
          `✅ **GitHub Connected!**\n\n` +
          `**Repository:** ${test.data.full_name}\n` +
          `**Visibility:** ${test.data.visibility}\n` +
          `**Issues:** ${test.data.has_issues ? "✅ Enabled" : "❌ Disabled"}\n` +
          `**URL:** ${test.data.html_url}`
        );
      } catch (error) {
        await message.reply(
          `❌ **GitHub Error**\n\n` +
          `**Status:** ${error.response?.status}\n` +
          `**Message:** ${error.response?.data?.message || error.message}`
        );
      }
      return;
    }

    // =====================
    // TICKET FLOW (!ticket)
    // =====================
    if (text.startsWith("!ticket")) {
      console.log("🎫 Ticket flow triggered");
      
      const issueText = text.replace("!ticket", "").trim();

      if (!issueText) {
        await message.reply(
          "⚠️ Please provide ticket details.\n" +
          "Example: `!ticket Login button is broken on mobile`"
        );
        return;
      }

      console.log(`📝 Ticket description: ${issueText.substring(0, 100)}`);

      // Check GitHub credentials
      if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        const missing = [];
        if (!GITHUB_TOKEN) missing.push("GITHUB_TOKEN");
        if (!GITHUB_OWNER) missing.push("GITHUB_OWNER");
        if (!GITHUB_REPO) missing.push("GITHUB_REPO");
        
        await message.reply(`❌ GitHub not configured. Missing: ${missing.join(", ")}`);
        return;
      }

      try {
        // Send typing indicator
        await message.channel.sendTyping();
        
        console.log(`📁 Creating issue in: ${GITHUB_OWNER}/${GITHUB_REPO}`);
        
        const issueRes = await axios.post(
          `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`,
          {
            title: `[Discord] ${issueText.slice(0, 60)}`,
            body: `**Reported by:** ${message.author.tag} (${message.author.id})\n\n**Issue:**\n${issueText}\n\n---\n*Created via Discord Bot*`,
            labels: ["from-discord", "auto-generated"]
          },
          {
            headers: {
              Authorization: `Bearer ${GITHUB_TOKEN}`,
              Accept: "application/vnd.github.v3+json"
            },
            timeout: 10000
          }
        );

        const issueUrl = issueRes.data.html_url;
        const issueNumber = issueRes.data.number;
        const issueNodeId = issueRes.data.node_id;

        console.log(`✅ Issue #${issueNumber} created: ${issueUrl}`);

        // Add to project board if configured
        let projectAdded = false;
        if (PROJECT_ID) {
          projectAdded = await addIssueToProject(issueNodeId);
        }

        const projectMessage = projectAdded ? "\n✅ Added to project board" : "";
        
        await message.reply(
          `✅ **GitHub Ticket Created!**\n\n` +
          `**Repository:** ${GITHUB_OWNER}/${GITHUB_REPO}\n` +
          `**Issue:** #${issueNumber}\n` +
          `**URL:** ${issueUrl}${projectMessage}`
        );
        
      } catch (githubError) {
        console.error("❌ GitHub Error:", {
          status: githubError.response?.status,
          data: githubError.response?.data,
          message: githubError.message
        });
        
        if (githubError.response?.status === 404) {
          await message.reply(`❌ Repository not found: ${GITHUB_OWNER}/${GITHUB_REPO}\n\nPlease check the repository name and your access permissions.`);
        } else if (githubError.response?.status === 401) {
          await message.reply("❌ GitHub token is invalid or expired. Please regenerate it in GitHub Settings → Developer settings → Personal access tokens.");
        } else if (githubError.response?.status === 403) {
          await message.reply("❌ GitHub token doesn't have permission to write to this repository. Make sure 'repo' scope is enabled.");
        } else {
          await message.reply(`❌ GitHub error: ${githubError.response?.data?.message || githubError.message}`);
        }
      }
      return;
    }

    // =====================
    // AI CHAT FLOW (GROQ)
    // =====================
    console.log("🤖 Routing to Groq AI...");
    
    if (!GROQ_API_KEY) {
      await message.reply("💡 AI chat is not configured yet. Contact server admin.");
      return;
    }

    try {
      // Send typing indicator
      await message.channel.sendTyping();
      
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
          },
          timeout: 15000
        }
      );

      const reply = aiRes.data?.choices?.[0]?.message?.content || "No response from AI";
      console.log(`✅ AI response sent (${reply.length} chars)`);
      
      // Split long messages (Discord limit is 2000 characters)
      if (reply.length > 1900) {
        const chunks = reply.match(/.{1,1900}/g);
        await message.reply(chunks[0]);
        for (let i = 1; i < chunks.length; i++) {
          await message.channel.send(chunks[i]);
        }
      } else {
        await message.reply(reply);
      }
      
    } catch (groqError) {
      console.error("❌ Groq Error:", {
        status: groqError.response?.status,
        data: groqError.response?.data,
        message: groqError.message
      });
      
      if (groqError.response?.status === 401) {
        await message.reply("🔑 Groq API key is invalid. Please check your GROQ_API_KEY environment variable.");
      } else if (groqError.response?.status === 429) {
        await message.reply("⏰ Groq rate limit exceeded. Please wait a moment and try again.");
      } else if (groqError.code === 'ECONNABORTED') {
        await message.reply("⏱️ AI service timeout. Please try again.");
      } else {
        await message.reply("⚠️ AI service error. Please try again later.");
      }
    }

  } catch (error) {
    console.error("❌ UNEXPECTED ERROR:", error);
    await message.reply("⚠️ Unexpected error. Please try again later.");
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
