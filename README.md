# Quartorium ✒️

**A collaborative WYSIWYG editor for Quarto, bridging the gap between reproducible research and seamless teamwork.**

Quartorium allows technical authors to share their Quarto (`.qmd`) documents with non-technical collaborators through a simple, clean, Word-like interface. Collaborators can edit prose and add comments without ever seeing code, while authors can review these changes and merge them back into a version-controlled Git workflow.

See demo on youtube:

[![Demo video](https://img.youtube.com/vi/yBLlVgVVQiE/0.jpg)](https://www.youtube.com/watch?v=yBLlVgVVQiE)


## ✨ Core Features

*   **Seamless Collaboration:** Share a simple link with collaborators. They get a clean WYSIWYG editor—no setup required.
*   **Code-Free Editing:** Quarto code chunks are hidden from collaborators. They see the plots and tables, but can only edit the surrounding prose.
*   **Git-Powered Version Control:** Every change is automatically committed to a separate Git branch, creating a perfect audit trail.
*   **Visual Diff & Merge:** Authors can visually review all suggestions, then accept or reject changes with the click of a button.
*   **Inline Commenting:** Highlight text to start a discussion, right in the margin.

## 🚀 Tech Stack

*   **Frontend:** React (Vite), TipTap (for the editor), Tailwind CSS
*   **Backend:** Node.js, Express.js
*   **Database:** SQLite
*   **Core Engine:** Git, Quarto CLI

## 🏁 Getting Started

Follow these instructions to get Quartorium running on your local machine for development and testing.

### Prerequisites

You must have the following tools installed directly on your system:
*   [Node.js](https://nodejs.org/) (v22.13 or later)
*   npm (included with Node.js) or [pnpm](https://pnpm.io/installation) 11
*   [Git](https://git-scm.com/)
*   [Quarto CLI](https://quarto.org/docs/get-started/) for backend rendering

### Frontend only

From the repository root, install and start just the frontend:

```bash
pnpm --filter frontend install --frozen-lockfile
pnpm start:frontend
```

Vite serves the UI at `http://localhost:5173` by default. This setup skips SQLite and its Windows build prerequisites. Sign-in and API requests still need the backend.

### Installation & Setup

1.  **Clone the repository:**
    ```bash
    git clone https://github.com/andjar/quartorium.git
    cd quartorium
    ```

2.  **Install all dependencies** with either package manager:
    ```bash
    pnpm install --frozen-lockfile
    ```

    ```bash
    npm ci --legacy-peer-deps
    ```

    On Windows, the backend's SQLite package downloads a prebuilt binary from GitHub. If the download fails and it compiles locally, install the Windows SDK through the Visual Studio Build Tools C++ workload and use Python 3.11 with the bundled node-gyp 8.

3.  **Set up environment variables:**
    Copy the example environment file. The default settings with SQLite should work out of the box for local development. You will still need to add GitHub API keys to enable login.
    ```bash
    cp backend/.env.example backend/.env
    ```
    To get your GitHub keys, create a new GitHub OAuth App in your developer settings.

4.  **Run the application:**
    You will need two separate terminal windows or tabs.

    *   **In Terminal 1 (for the Backend):**
        ```bash
        npm run start:backend
        ```
        This will start the backend API server, typically on `http://localhost:8000`.

    *   **In Terminal 2 (for the Frontend):**
        ```bash
        npm run start:frontend
        ```
        This starts the React development server at `http://localhost:5173` by default.

5.  **Open the app:**
    Navigate to `http://localhost:5173` in your web browser.

### Scripts

The root `package.json` contains helper scripts to manage the project:
*   `npm run start:backend`: Starts the backend server in development mode.
*   `npm run start:frontend`: Starts the frontend development server.

With pnpm, use `pnpm start:backend` and `pnpm start:frontend` after installing the corresponding workspaces.

### ⚠️ A Note on Security

This development setup runs the `quarto render` command directly on your machine. **Do not use this application with untrusted `.qmd` files from the internet**, as they could contain malicious code. For personal use and with trusted collaborators, this setup is fine. A public-facing production deployment would require sandboxing this process (e.g., using Docker).

## 📄 License

This project is licensed under the GPL3 License - see the `LICENSE` file for details.
