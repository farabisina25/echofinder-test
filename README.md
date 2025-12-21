# EchoFinder AI Bot 🤖

An intelligent GitHub bot that detects duplicate issues using **Sentence-BERT** embeddings (stored in **PostgreSQL/pgvector**) and helps you merge them using **Google Gemini AI**.

---

## 🌟 Key Features

*   **🧠 Smart Detection**: Uses semantic embeddings to find duplicates, even if phrased differently.
*   **🌍 Cross-Repository Support**: Detects duplicates across *all* repositories in your organization.
*   **🤖 AI-Powered Merging**: merging issues? Just type `/merge`. Gemini AI will combine them into a single, comprehensive issue using the best details from both.
*   **⚡ Instant Preview**: See a draft of the fused issue *before* you merge.
*   **🗄️ Vector Database**: High-performance similarity search using PostgreSQL + `pgvector`.

---

## �️ Prerequisites

1.  **Node.js** (v18+)
2.  **Python** (v3.8+)
3.  **PostgreSQL** (with `pgvector` extension installed)
4.  **GitHub Account** (to create the App)
5.  **Google Gemini API Key** (for AI merging)

---

## 🚀 Setup Guide

### 1. Database Setup
Ensure you have PostgreSQL installed. Enable the `vector` extension:
```sql
CREATE EXTENSION vector;
```
Create a database (e.g., `echofinder`).

### 2. Environment Configuration
Create a `.env` file in the root directory:

```env
# GitHub App Credentials
APP_ID=your_app_id
PRIVATE_KEY_PATH=private-key.pem
WEBHOOK_SECRET=your_webhook_secret
WEBHOOK_PROXY_URL=https://smee.io/your-url

# Database (PostgreSQL)
DATABASE_URL=postgresql://user:password@localhost:5432/echofinder

# AI Services
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
EMBEDDING_SERVER=http://127.0.0.1:8001
```

### 3. Install Dependencies

**Node.js (Bot & Server):**
```bash
npm install
```

**Python (Embedding Microservice):**
```bash
pip install sentence-transformers uvicorn fastapi
```

### 4. Initialize Database
Run the initialization script to create the required tables:
```bash
npm run init-db
```

---

## 🏃 Running the Application

### Option A: Quick Start with Docker (Recommended)
Run the entire stack (Bot + App + DB + Python Service) with one command:
```bash
docker-compose up --build
```
*Note: You still need to run the `smee` client locally to forward webhooks to your docker container (or configure your webhook proxy to point to your docker host).*

### Option B: Manual Setup

You need to run these **three process** (ideally in separate terminals):

### Terminal 1: Embedding Service (Python)
Generates vector embeddings for issues.
```bash
python embedding_service.py
```

### Terminal 2: Webhook Forwarder (Smee)
Forwards GitHub events to your local machine.
```bash
smee -u https://smee.io/YOUR_URL -t http://localhost:3000/api/github/webhooks
```

### Terminal 3: The Bot (Node.js)
Runs the main application logic.
```bash
npm run clean-start
```
*(Note: `npm run clean-start` automatically frees port 3000 before starting)*

---

## 🎮 Usage

### 1. Duplicate Detection
Just open a new issue!
- If a similar issue exists (even in another repo from same owner!), the bot will post a comment.
- The comment includes a **"Proposed Merged Issue"** preview hidden in a dropdown.

### 2. Merging Issues
To merge a duplicate:
1.  Both issue authors (the new one and the original one) must comment `/merge` on their respective issues.
2.  Once confirmed, the bot will:
    *   **Create** a new merged issue in the *Original Repository*.
    *   **Close** both old issues.
    *   **Link** everything together.

### Commands
-   `/merge`: Approve the merge.
-   `/reject`: Decline the merge.

---

## 🧠 Architecture
-   **Bot Logic**: Node.js (Probot)
-   **Embeddings**: Python (Sentence-BERT)
-   **Storage**: PostgreSQL (`pgvector`)
-   **Generative AI**: Google Gemini 2.5 Flash

---

## � Troubleshooting
-   **503 Overloaded?**: The bot automatically falls back to `gemini-2.5-flash` if the primary model is busy.
-   **"Repo not found"?**: Ensure the bot is installed on *all* target repositories.

---

Made with ❤️ by EchoFinder Team
