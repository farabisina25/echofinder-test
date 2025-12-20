# EchoFinder AI Bot 🤖

An intelligent GitHub bot that detects duplicate issues using **Sentence-BERT** embeddings (stored in **PostgreSQL/pgvector**) and helps you merge them using **Google Gemini AI**.

---

## 🌟 Key Features

- **🧠 Smart Detection**: Uses semantic embeddings to find duplicates, even if phrased differently.
- **🌍 Cross-Repository Support**: Detects duplicates across _all_ repositories in your organization.
- **🤖 AI-Powered Merging**: merging issues? Just type `/merge`. Gemini AI will combine them into a single, comprehensive issue using the best details from both.
- **⚡ Instant Preview**: See a draft of the fused issue _before_ you merge.
- **🗄️ Vector Database**: High-performance similarity search using PostgreSQL + `pgvector`.

---

## 🛠️ Prerequisites

- **Docker** and **Docker Compose** (recommended)
- **GitHub Account** (to create the App)
- **Google Gemini API Key** (for AI merging)

_For manual setup without Docker: Node.js (v18+), Python (v3.8+), PostgreSQL with pgvector_

---

## 🚀 Quick Start with Docker (Recommended)

### 1. Configuration

Create a `.env` file in the `echofinder/` directory:

```env
# GitHub App Credentials
APP_ID=your_app_id
WEBHOOK_SECRET=your_webhook_secret
WEBHOOK_PROXY_URL=https://smee.io/your-url

# AI Services
GEMINI_API_KEY=your_gemini_api_key
```

Place your GitHub App's `private-key.pem` in the `echofinder/` directory.

### 2. Build & Run

```bash
cd echofinder
docker compose up --build -d
```

This starts:

- **Node.js Bot** (port 3000)
- **Python Embedding Service** (port 8001)
- **PostgreSQL + pgvector** (port 5432)

### 3. Verify

```bash
docker compose ps
docker compose logs -f app
```

### 4. Stop

```bash
docker compose down        # Stop containers
docker compose down -v     # Stop and remove database volume
```

---

## 🔧 Manual Setup (Alternative)

<details>
<summary>Click to expand manual setup instructions</summary>

### Prerequisites

1.  **Node.js** (v18+)
2.  **Python** (v3.8+)
3.  **PostgreSQL** (with `pgvector` extension installed)

### 1. Database Setup

```sql
CREATE EXTENSION vector;
CREATE DATABASE echofinder;
```

### 2. Environment Configuration

Create `.env` in `echofinder/`:

```env
APP_ID=your_app_id
PRIVATE_KEY_PATH=private-key.pem
WEBHOOK_SECRET=your_webhook_secret
WEBHOOK_PROXY_URL=https://smee.io/your-url
DATABASE_URL=postgresql://user:password@localhost:5432/echofinder
GEMINI_API_KEY=your_gemini_api_key
EMBEDDING_SERVER=http://127.0.0.1:8001
```

### 3. Install Dependencies

```bash
# Node.js
cd echofinder
npm install

# Python
pip install sentence-transformers uvicorn fastapi
```

### 4. Initialize Database

```bash
cd echofinder
npm run init-db
```

### 5. Run (3 separate terminals)

**Terminal 1: Embedding Service**

```bash
python embedding_service.py
```

**Terminal 2: Webhook Forwarder**

```bash
smee -u https://smee.io/YOUR_URL -t http://localhost:3000/api/github/webhooks
```

**Terminal 3: Bot**

```bash
cd echofinder
npm run clean-start
```

</details>

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
    - **Create** a new merged issue in the _Original Repository_.
    - **Close** both old issues.
    - **Link** everything together.

### Commands

- `/merge`: Approve the merge.
- `/reject`: Decline the merge.

---

## 🧠 Architecture

- **Bot Logic**: Node.js (Probot)
- **Embeddings**: Python (Sentence-BERT)
- **Storage**: PostgreSQL (`pgvector`)
- **Generative AI**: Google Gemini 2.5 Flash

---

## � Troubleshooting

- **503 Overloaded?**: The bot automatically falls back to `gemini-2.5-flash` if the primary model is busy.
- **"Repo not found"?**: Ensure the bot is installed on _all_ target repositories.

---

Made with ❤️ by EchoFinder Team
