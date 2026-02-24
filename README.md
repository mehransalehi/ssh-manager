# SSH Proxy Manager

A cross-platform desktop application built with **Electron** and **Vue.js** for managing SSH proxy tunnels.  
The app provides an intuitive UI to manage servers, credentials, port forwarding, and proxy connections, along with network speed testing.

---

## 🚀 Tech Stack

- **Electron** – Cross-platform desktop framework  
- **Vue.js** – Frontend framework  
- **Tailwind CSS** – Utility-first styling  
- **FontAwesome** – Icons  
- **SQLite** – Local lightweight database  

---

## ✨ Features

### SSH Tunnel Management
- Create and manage SSH proxy tunnels
- Open local SOCKS proxy ports
- Secure authentication with username/password
- Reuse saved credentials across multiple servers

### Server Management
- Import single server IP
- Bulk import multiple server IPs
- Save and reuse authentication credentials
- Manage local port configurations
- Store server configurations in SQLite database

### Port Forwarding
- Configure local port forwarding
- Automatic SOCKS proxy port opening
- Flexible local-to-remote port mapping

### Monitoring & Testing
- Ping system
- Speed test per server
- Speed test all servers
- Connection status tracking

### System Tray Support
- Tray icon integration
- Quick access to running tunnels
- Background operation support

---

## 🧠 How It Works

1. User defines local authentication (username, password, port).  
2. During server creation, user can reuse saved credentials.  
3. Upon connection:  
   - SSH tunnel is established  
   - Local port is opened  
   - SOCKS proxy becomes available  
4. Users can test latency and speed before or after connection.

---

## 📦 Database

Uses **SQLite** to:  
- Store server lists  
- Save authentication credentials  
- Manage port configurations  
- Persist connection settings  

---

## 🎯 Use Cases

- Secure browsing via SSH SOCKS proxy  
- Managing multiple VPS or remote servers  
- Developers needing quick SSH tunnel management  
- Network testing and latency comparison  

---

## 🛠 Installation (Development)

```bash
npm install
NODE_ENV=development npm run dev
```

## 🛠 Build

```bash
npx run dist
```
