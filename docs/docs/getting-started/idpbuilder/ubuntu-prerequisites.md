# Ubuntu Prerequisites - Manual Setup

Copy and paste these commands in your terminal to set up the CAIPE platform and i3 desktop environment with VNC access.

## Prerequisites

- Ubuntu 20.04+ (tested on Ubuntu 22.04)
- sudo access
- Internet connection

## Step 1: Pre-Flight Cleanup

First, clean up any existing dependency conflicts:

```bash
# Remove duplicate repositories
sudo rm -f /etc/apt/sources.list.d/archive_uri-https_apt_releases_hashicorp_com-*.list
sudo rm -f /etc/apt/sources.list.d/hashicorp.list
sudo rm -f /etc/apt/sources.list.d/archive_uri-https_cli_github_com_packages-*.list
sudo rm -f /etc/apt/sources.list.d/github-cli.list
sudo rm -f /etc/apt/sources.list.d/archive_uri-https_download_docker_com_linux_ubuntu-*.list
sudo rm -f /etc/apt/sources.list.d/docker.list
```

```bash
# Fix broken dependencies
if ! sudo apt install -y curl >/dev/null 2>&1; then
    echo "Detected broken dependencies, attempting to fix..."
    sudo apt --fix-broken install -y || true
    sudo apt autoremove -y || true
    sudo apt update || true

    # Remove conflicting Amazon packages if present
    if dpkg -l | grep -q amazon-q; then
        echo "Found amazon-q package, attempting removal..."
        sudo apt remove --purge -y amazon-q || true
        sudo dpkg --remove --force-remove-reinstreq amazon-q 2>/dev/null || true
        sudo apt install -y libwebkit2gtk-4.1-0 || true
        sudo apt --fix-broken install -y || true
        sudo apt autoremove -y || true
        sudo apt update || true
    fi
fi
```

## Step 2: Install Basic Tools

```bash
# Update package lists and install essential tools
sudo apt update
sudo apt install -y vim jq software-properties-common curl wget
```

## Step 3: Install Docker

```bash
# Install Docker with modern keyring method
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
```

```bash
# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
```

```bash
# Install Docker components
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

```bash
# Add user to docker group and verify
sudo groupadd docker 2>/dev/null || true
sudo usermod -aG docker $USER
sudo docker run hello-world
```

> **Note**: You may need to log out and back in for the docker group changes to take effect, or run `newgrp docker` to apply the group change in the current session.

## Step 4: Install kubectl

```bash
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
chmod +x kubectl
sudo mv kubectl /usr/local/bin/
```

## Step 5: Install Vault

```bash
# Clean up any existing HashiCorp repositories to avoid duplicates
sudo rm -f /etc/apt/sources.list.d/archive_uri-https_apt_releases_hashicorp_com-*.list
sudo rm -f /etc/apt/sources.list.d/hashicorp.list
```

```bash
# Install Vault with modern keyring method
curl -fsSL https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor --yes -o /etc/apt/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/etc/apt/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
```

```bash
sudo apt update
sudo apt install -y vault
```

## Step 6: Install GitHub CLI

```bash
# Install GitHub CLI with modern keyring method
curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg
sudo chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null
```

```bash
sudo apt update
sudo apt install -y gh
```

## Step 7: Install IDPBuilder

```bash
# Get latest IDPBuilder release
arch=$(if [[ "$(uname -m)" == "x86_64" ]]; then echo "amd64"; else uname -m; fi)
os=$(uname -s | tr '[:upper:]' '[:lower:]')
idpbuilder_latest_tag=$(curl --silent "https://api.github.com/repos/cnoe-io/idpbuilder/releases/latest" | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
```

```bash
# Download and install IDPBuilder
curl -LO https://github.com/cnoe-io/idpbuilder/releases/download/$idpbuilder_latest_tag/idpbuilder-$os-$arch.tar.gz
tar xvzf idpbuilder-$os-$arch.tar.gz
chmod +x idpbuilder
sudo mv idpbuilder /usr/local/bin
rm idpbuilder-linux-amd64.tar.gz LICENSE README.md 2>/dev/null || true
```

## Step 8: Install K9s

```bash
# Download and install K9s
wget https://github.com/derailed/k9s/releases/download/v0.50.12/k9s_linux_amd64.deb
sudo dpkg -i k9s_linux_amd64.deb || sudo apt --fix-broken install -y
rm k9s_linux_amd64.deb
```

## Step 9: Install Kind

```bash
# Install Kind (Kubernetes in Docker)
curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.20.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
```

## Step 10: Verify Installation

```bash
# Check all tools are installed
for tool in docker kubectl vault gh k9s idpbuilder kind; do
    if command -v "$tool" &> /dev/null; then
        echo "✅ $tool is installed"
    else
        echo "❌ $tool is not installed or not in PATH"
    fi
done
```

## Step 11: i3 Desktop Environment Setup (Optional)

For a complete development environment with VNC access, set up i3 desktop environment:

### Remove GNOME and Install i3

```bash
# Remove GNOME (if present)
sudo apt remove --purge ubuntu-desktop gnome-shell gnome-session gdm3 -y 2>/dev/null || true
sudo apt autoremove --purge -y
```

```bash
# Install required dependencies for webkit first
sudo apt install -y libwebkit2gtk-4.1-0
```

```bash
# Install i3 and VNC packages
sudo apt install -y i3 i3status i3lock dmenu rofi xorg lightdm xterm terminator xclip parcellite firefox tigervnc-standalone-server
```

### Create i3 Configuration

```bash
mkdir -p ~/.config/i3
cat > ~/.config/i3/config << 'EOF'
# i3 config - Mac compatible (Alt key)
set $mod Mod1
font pango:monospace 8
floating_modifier $mod

# Terminal shortcuts
bindsym $mod+Return exec terminator
bindsym $mod+t exec terminator

# Application shortcuts
bindsym $mod+Shift+q kill
bindsym $mod+d exec rofi -show run
bindsym $mod+space exec rofi -show drun
bindsym $mod+f exec firefox

# Navigation
bindsym $mod+Left focus left
bindsym $mod+Down focus down
bindsym $mod+Up focus up
bindsym $mod+Right focus right

# Move windows
bindsym $mod+Shift+Left move left
bindsym $mod+Shift+Down move down
bindsym $mod+Shift+Up move up
bindsym $mod+Shift+Right move right

# Splits and layout
bindsym $mod+h split h
bindsym $mod+v split v
bindsym $mod+F11 fullscreen toggle
bindsym $mod+Shift+space floating toggle
bindsym $mod+Tab focus mode_toggle

# Workspaces
set $ws1 "1"
set $ws2 "2"
set $ws3 "3"
set $ws4 "4"
set $ws5 "5"

bindsym $mod+1 workspace number $ws1
bindsym $mod+2 workspace number $ws2
bindsym $mod+3 workspace number $ws3
bindsym $mod+4 workspace number $ws4
bindsym $mod+5 workspace number $ws5

bindsym $mod+Shift+1 move container to workspace number $ws1
bindsym $mod+Shift+2 move container to workspace number $ws2
bindsym $mod+Shift+3 move container to workspace number $ws3
bindsym $mod+Shift+4 move container to workspace number $ws4
bindsym $mod+Shift+5 move container to workspace number $ws5

# System
bindsym $mod+Shift+c reload
bindsym $mod+Shift+r restart
bindsym $mod+Shift+e exec "i3-nagbar -t warning -m 'Exit i3?' -B 'Yes' 'i3-msg exit'"

# Status bar
bar {
    status_command i3status
}
EOF
```

### Configure VNC

```bash
mkdir -p ~/.vnc
cat > ~/.vnc/xstartup << 'EOF'
#!/bin/bash
export DISPLAY=:1
xhost +local: &
xsetroot -solid grey &
parcellite &
terminator -g 80x24+10+10 &
firefox &
exec i3
EOF
chmod +x ~/.vnc/xstartup
```

### Set VNC Password and Start Server

```bash
# Set VNC password (you'll be prompted)
vncpasswd
```

```bash
# Start VNC server
vncserver :1 -geometry 2560x1400 -depth 24 -localhost yes
```

### Connect via SSH Tunnel

```bash
# Create SSH tunnel (replace with your actual server details)
ssh -i ~/.ssh/private.pem -L 5903:localhost:5901 ubuntu@<YOUR UBUNTU IP> -f -N
```

### Connect VNC Client

Connect to `localhost:5903` using your VNC client (TigerVNC, RealVNC Viewer, or built-in screen sharing on Mac).

## i3 Keyboard Shortcuts

- `Alt+Return` - Open terminal
- `Alt+d` - Application launcher
- `Alt+Space` - Application menu
- `Alt+f` - Open Firefox
- `Alt+1,2,3,4,5` - Switch workspaces
- `Alt+Shift+1,2,3,4,5` - Move window to workspace


## VNC Management Commands

```bash
# List VNC sessions
vncserver -list
```

```bash
# Kill VNC session
vncserver -kill :1
```

```bash
# Restart VNC with new resolution
vncserver :1 -geometry 2560x1400 -depth 24 -localhost yes
```

```bash
# Start VNC viewer with SSH tunnel
ssh -i ~/.ssh/private.pem -L 5903:localhost:5901 ubuntu@<YOUR UBUNTU IP> -f -N && vncviewer localhost:5903
```

## Cleanup

```bash
# Destroy the idpbuilder cluster and all resources
idpbuilder delete
```

```bash
# Stop VNC server (if running)
vncserver -kill :1
```

