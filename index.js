require("dotenv").config();
const axios = require("axios");
const { Client } = require("@notionhq/client");
const fs = require("fs");

// <-- Api de Notion y GitHub -->
const notion = new Client({ auth: process.env.NOTION_TOKEN });
const github = axios.create({
  baseURL: "https://api.github.com/",
  headers: { Authorization: `token ${process.env.GITHUB_TOKEN}` },
});

// <-- Issues de Notion -->
async function getNotionData() {
  const results = await notion.databases.query({
    database_id: process.env.NOTION_DATABASE_ID,
  });
  fs.writeFileSync("notion.json", JSON.stringify(results.results, null, 2));
  return results.results;
}

// <-- Issues de GitHub -->
async function getGithubIssues(owner, repo) {
  const response = await github.get(`repos/${owner}/${repo}/issues?state=all`);
  fs.writeFileSync("github.json", JSON.stringify(response.data, null, 2));
  return response.data;
}

// <-- Sincronizar GitHub -> Notion -->
async function syncGithubToNotion(notionData, githubIssues) {
  for (const gitIssue of githubIssues) {
    const notionIssue = notionData.find((item) => {
      return (
        item.properties["GitHub Issue ID"] &&
        item.properties["GitHub Issue ID"].number === gitIssue.id
      );
    });

    const issueBody = gitIssue.body ? gitIssue.body : "";

    if (!notionIssue) {
      // Crear nueva entrada en Notion si no existe
      await notion.pages.create({
        parent: { database_id: process.env.NOTION_DATABASE_ID },
        properties: {
          Issue: { title: [{ text: { content: gitIssue.title } }] },
          Body: { rich_text: [{ text: { content: issueBody } }] },
          "GitHub Issue ID": { number: gitIssue.id },
          "GitHub Issue URL": { url: gitIssue.html_url },
          Status: { checkbox: gitIssue.state === "closed" },
          "Last Synced": { date: { start: new Date().toISOString() } },
        },
      });
    } else {
      const lastSynced = new Date(
        notionIssue.properties["Last Synced"].date.start
      );
      const issueUpdatedAt = new Date(gitIssue.updated_at);

      if (issueUpdatedAt > lastSynced) {
        // Actualizar entrada en Notion si GitHub issue es más reciente
        await notion.pages.update({
          page_id: notionIssue.id,
          properties: {
            Issue: { title: [{ text: { content: gitIssue.title } }] },
            Body: { rich_text: [{ text: { content: issueBody } }] },
            "GitHub Issue ID": { number: gitIssue.id },
            "GitHub Issue URL": { url: gitIssue.html_url },
            Status: { checkbox: gitIssue.state === "closed" },
            "Last Synced": { date: { start: new Date().toISOString() } },
          },
        });
      }
    }
  }
}

// <-- Sincronizar Notion -> GitHub -->
async function syncNotionToGithub(notionData, githubIssues) {
  for (const notionIssue of notionData) {
    const githubIssue = githubIssues.find(
      (gitIssue) =>
        gitIssue.id === notionIssue.properties["GitHub Issue ID"].number
    );

    const lastSynced = new Date(
      notionIssue.properties["Last Synced"].date.start
    );
    const notionUpdatedAt = new Date(notionIssue.last_edited_time);

    if (!githubIssue) {
      // Crear nuevo gitIssue en GitHub si no existe
      const newIssue = await github.post(
        `repos/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}/issues`,
        {
          title: notionIssue.properties["Issue"].title[0].text.content,
          body: notionIssue.properties["Body"].rich_text[0].text.content,
        }
      );

      // Actualizar Notion con el ID y URL del nuevo gitIssue
      await notion.pages.update({
        page_id: notionIssue.id,
        properties: {
          "GitHub Issue ID": { number: newIssue.data.id },
          "GitHub Issue URL": { url: newIssue.data.html_url },
          "Last Synced": { date: { start: new Date().toISOString() } },
        },
      });
    } else {
      if (notionUpdatedAt > lastSynced) {
        // Actualizar gitIssue en GitHub si Notion issue es más reciente
        await github.patch(
          `repos/${process.env.GITHUB_REPO_OWNER}/${process.env.GITHUB_REPO_NAME}/issues/${githubIssue.number}`,
          {
            title: notionIssue.properties["Issue"].title[0].text.content,
            body: notionIssue.properties["Body"].rich_text[0].text.content,
            state: notionIssue.properties["Status"].checkbox
              ? "closed"
              : "open",
          }
        );

        // Actualizar Notion con la última sincronización
        await notion.pages.update({
          page_id: notionIssue.id,
          properties: {
            "Last Synced": { date: { start: new Date().toISOString() } },
            Status: { checkbox: notionIssue.properties["Status"].checkbox },
          },
        });
      }
    }
  }
}

async function syncNotionAndGithub() {
  const notionData = await getNotionData();
  const githubIssues = await getGithubIssues(
    process.env.GITHUB_REPO_OWNER,
    process.env.GITHUB_REPO_NAME
  );

  await syncGithubToNotion(notionData, githubIssues);
  await syncNotionToGithub(notionData, githubIssues);
}

syncNotionAndGithub().catch(console.error);
