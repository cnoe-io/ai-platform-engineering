---
sidebar_position: 6
---

# Troubleshooting Guide

This guide covers common issues you may encounter when using or developing the CAIPE UI, along with solutions and debugging tips.

## Quick Diagnostics

Run these commands to quickly diagnose common issues:

```bash
# Check if CAIPE supervisor is running
curl http://localhost:8000/.well-known/agent-card.json

# Check if UI is running
curl http://localhost:3000/api/health

# Check environment variables
cat ui/.env.local

# Check Node.js version
node --version  # Should be 18.17.0+

# Check npm version
npm --version   # Should be 9.0.0+

# Check Docker containers (if using Docker)
docker ps | grep caipe
```

## Connection Issues

### Issue: "Cannot connect to CAIPE supervisor"

**Symptoms:**
- Chat messages fail to send
- "Connection refused" or "ECONNREFUSED" errors
- Context panel shows "Disconnected" status

**Solutions:**

1. **Verify supervisor is running:**

```bash
# Check if supervisor is accessible
curl http://localhost:8000/.well-known/agent-card.json

# If using Docker
docker ps | grep caipe-supervisor

# Start supervisor if not running
docker compose -f docker-compose.dev.yaml up caipe-supervisor
```

2. **Check CAIPE_URL configuration:**

```bash
# Verify .env.local
cat ui/.env.local | grep CAIPE_URL

# Should show:
# CAIPE_URL=http://localhost:8000
# NEXT_PUBLIC_CAIPE_URL=http://localhost:8000

# If incorrect, update:
echo "CAIPE_URL=http://localhost:8000" >> ui/.env.local
echo "NEXT_PUBLIC_CAIPE_URL=http://localhost:8000" >> ui/.env.local
```

3. **Restart UI server:**

```bash
# Kill existing process
pkill -f "next-server"

# Start fresh
cd ui
npm run dev
```

4. **Check network connectivity (Docker):**

```bash
# From UI container, test supervisor
docker exec caipe-ui curl http://caipe-supervisor:8000/.well-known/agent-card.json

# Check Docker network
docker network inspect ai-platform-engineering_default
```

### Issue: "CORS errors in browser console"

**Symptoms:**
- Browser console shows: `Access to fetch blocked by CORS policy`
- Requests fail with CORS errors

**Solutions:**

1. **Verify CAIPE supervisor CORS configuration:**

```python
# In CAIPE supervisor code
allow_origins = [
    "http://localhost:3000",
    "http://localhost:3001",
    # Add your production domain
]
```

2. **Use NEXT_PUBLIC_CAIPE_URL:**

```bash
# Ensure client uses correct URL
export NEXT_PUBLIC_CAIPE_URL=http://localhost:8000
npm run dev
```

3. **Proxy through Next.js (workaround):**

```typescript
// next.config.js
module.exports = {
  async rewrites() {
    return [
      {
        source: '/api/caipe/:path*',
        destination: 'http://localhost:8000/:path*',
      },
    ];
  },
};
```

## Authentication Issues

### Issue: "Authentication fails / redirect loop"

**Symptoms:**
- Keeps redirecting to login page
- "Invalid session" errors
- Session expires immediately

**Solutions:**

1. **Check NextAuth configuration:**

```bash
# Verify NEXTAUTH_URL matches your domain
cat ui/.env.local | grep NEXTAUTH

# Should match where UI is running:
# NEXTAUTH_URL=http://localhost:3000
```

2. **Verify NEXTAUTH_SECRET is set:**

```bash
# Check if secret exists
cat ui/.env.local | grep NEXTAUTH_SECRET

# If missing, generate one:
openssl rand -base64 32 >> ui/.env.local
```

3. **Clear browser cookies:**

```javascript
// In browser console
document.cookie.split(";").forEach((c) => {
  document.cookie = c
    .replace(/^ +/, "")
    .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
});
location.reload();
```

4. **Skip auth for development:**

```bash
# Temporarily disable auth
echo "SKIP_AUTH=true" >> ui/.env.local
npm run dev
```

5. **Check OAuth provider configuration:**

```bash
# Verify OAuth credentials
echo $OAUTH_CLIENT_ID
echo $OAUTH_CLIENT_SECRET

# Test OAuth endpoints
curl $OAUTH_AUTHORIZATION_URL
```

### Issue: "Unauthorized API requests"

**Symptoms:**
- API returns 401 Unauthorized
- Requests work in browser but fail in scripts

**Solutions:**

1. **Include session cookie:**

```bash
# Login and save cookies
curl -X POST http://localhost:3000/api/auth/signin \
  -c cookies.txt \
  -d '{"email": "user@example.com"}'

# Use cookies in requests
curl http://localhost:3000/api/usecases \
  -b cookies.txt
```

2. **Use Bearer token (if implemented):**

```bash
curl http://localhost:3000/api/usecases \
  -H "Authorization: Bearer <token>"
```

## Streaming Issues

### Issue: "Real-time messages not appearing"

**Symptoms:**
- Context panel shows no events
- Messages don't stream in real-time
- SSE connection fails

**Solutions:**

1. **Check browser SSE support:**

```javascript
// In browser console
if (typeof EventSource === "undefined") {
  console.error("SSE not supported");
} else {
  console.log("SSE supported");
}
```

2. **Verify SSE endpoint:**

```bash
# Test SSE connection manually
curl -N http://localhost:8000/v1/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"message": "test"}'
```

3. **Check browser network tab:**

- Open DevTools (F12)
- Go to Network tab
- Filter by "EventStream" or "SSE"
- Look for active connections

4. **Disable browser extensions:**

Some ad blockers or privacy extensions may block SSE connections.

5. **Check proxy/load balancer timeouts:**

```nginx
# nginx.conf (if using nginx)
location /v1/chat/stream {
    proxy_read_timeout 300s;
    proxy_connect_timeout 75s;
    proxy_buffering off;
    proxy_cache off;
}
```

### Issue: "Streaming stops after a few messages"

**Symptoms:**
- First few messages appear
- Then stream stops
- No error messages

**Solutions:**

1. **Check connection keep-alive:**

```typescript
// In a2a-client.ts, verify EventSource setup
const eventSource = new EventSource(url, {
  withCredentials: true,
});

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
  // Reconnect logic
};
```

2. **Monitor for memory leaks:**

```javascript
// In browser console
performance.memory  // Check heap size
```

3. **Check CAIPE supervisor logs:**

```bash
# Docker logs
docker logs caipe-supervisor --tail 100 -f

# Look for errors, disconnections
```

## Storage Issues

### Issue: "Use cases not persisting"

**Symptoms:**
- Created use cases disappear after reload
- "Failed to save use case" errors

**Solutions:**

1. **File storage - check permissions:**

```bash
# Ensure data directory exists and is writable
mkdir -p ui/data
chmod 755 ui/data

# Check file permissions
ls -la ui/data/usecases.json
```

2. **File storage - verify path:**

```bash
# Check storage configuration
cat ui/.env.local | grep USECASE_STORAGE

# Should show:
# USECASE_STORAGE_TYPE=file
# USECASE_STORAGE_PATH=./data/usecases.json
```

3. **MongoDB - test connection:**

```bash
# Test MongoDB connectivity
mongosh "$MONGODB_URI" --eval "db.adminCommand('ping')"

# Check if database exists
mongosh "$MONGODB_URI" --eval "show dbs"

# Check collection
mongosh "$MONGODB_URI" --eval "db.usecases.count()"
```

4. **MongoDB - verify URI format:**

```bash
# Common URI formats:
# Local: mongodb://localhost:27017/caipe
# With auth: mongodb://user:pass@localhost:27017/caipe
# Atlas: mongodb+srv://user:pass@cluster.mongodb.net/caipe

# Test with mongosh
mongosh "$MONGODB_URI"
```

5. **Switch storage backends:**

```bash
# Switch to file storage temporarily
export USECASE_STORAGE_TYPE=file
npm run dev
```

### Issue: "MongoDB driver not found"

**Symptoms:**
- Error: "Cannot find module 'mongodb'"
- MongoDB storage fails to initialize

**Solutions:**

```bash
# Install MongoDB driver
cd ui
npm install mongodb

# Restart server
npm run dev
```

## Build and Deployment Issues

### Issue: "Build fails with TypeScript errors"

**Symptoms:**
- `npm run build` fails
- Type errors in production build

**Solutions:**

1. **Check TypeScript version:**

```bash
npx tsc --version  # Should be 5.x
```

2. **Run type checking:**

```bash
npx tsc --noEmit
```

3. **Fix common type errors:**

```typescript
// Error: Property 'X' does not exist on type 'Y'
// Solution: Add type annotation or extend interface

// Error: Type 'null' is not assignable to type 'string'
// Solution: Use optional chaining or null checks
const value = data?.field ?? 'default';
```

4. **Clear cache and rebuild:**

```bash
rm -rf .next node_modules
npm install
npm run build
```

### Issue: "Out of memory during build"

**Symptoms:**
- `JavaScript heap out of memory`
- Build fails on CI/CD

**Solutions:**

1. **Increase Node.js memory:**

```bash
# Set NODE_OPTIONS
export NODE_OPTIONS="--max-old-space-size=4096"
npm run build
```

2. **Add to package.json:**

```json
{
  "scripts": {
    "build": "NODE_OPTIONS='--max-old-space-size=4096' next build"
  }
}
```

3. **Optimize build:**

```javascript
// next.config.js
module.exports = {
  // Disable source maps in production
  productionBrowserSourceMaps: false,
  
  // Enable SWC minification
  swcMinify: true,
};
```

### Issue: "Docker build fails"

**Symptoms:**
- Docker build times out
- Image build errors

**Solutions:**

1. **Check Dockerfile:**

```dockerfile
# Ensure proper Node version
FROM node:20-alpine

# Copy package files first
COPY package*.json ./
RUN npm ci

# Then copy source
COPY . .
RUN npm run build
```

2. **Use build cache:**

```bash
# Build with cache
docker build --cache-from caipe-ui:latest -t caipe-ui:new .
```

3. **Increase Docker memory:**

```bash
# Docker Desktop: Settings > Resources > Memory
# Or use --memory flag
docker build --memory 4g -t caipe-ui .
```

## Performance Issues

### Issue: "UI is slow / laggy"

**Symptoms:**
- Slow page loads
- Laggy interactions
- High CPU usage

**Solutions:**

1. **Check bundle size:**

```bash
# Analyze bundle
ANALYZE=true npm run build

# Look for large dependencies
```

2. **Enable production mode:**

```bash
# Production builds are much faster
npm run build
npm start
```

3. **Use memoization:**

```typescript
// Memoize expensive components
import { memo } from 'react';

export const ExpensiveComponent = memo(({ data }) => {
  // Component logic
});
```

4. **Virtual scrolling for large lists:**

```typescript
import { useVirtualizer } from '@tanstack/react-virtual';

// Implement virtual scrolling for message lists
```

5. **Monitor performance:**

```javascript
// In browser console
performance.getEntriesByType('navigation')[0]
```

### Issue: "Memory leaks"

**Symptoms:**
- Memory usage grows over time
- Browser tab becomes unresponsive

**Solutions:**

1. **Check for unclosed connections:**

```typescript
useEffect(() => {
  const eventSource = new EventSource(url);
  
  // ✅ Always clean up
  return () => {
    eventSource.close();
  };
}, [url]);
```

2. **Remove event listeners:**

```typescript
useEffect(() => {
  const handler = () => { /* ... */ };
  window.addEventListener('resize', handler);
  
  // ✅ Clean up
  return () => {
    window.removeEventListener('resize', handler);
  };
}, []);
```

3. **Clear intervals/timeouts:**

```typescript
useEffect(() => {
  const interval = setInterval(() => { /* ... */ }, 1000);
  
  // ✅ Clean up
  return () => {
    clearInterval(interval);
  };
}, []);
```

## Browser-Specific Issues

### Chrome / Edge

**Issue:** "DevTools shows warnings about passive event listeners"

```typescript
// Add passive: true to scroll listeners
element.addEventListener('scroll', handler, { passive: true });
```

### Firefox

**Issue:** "CSS grid layout issues"

```css
/* Use explicit grid template */
.container {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
}
```

### Safari

**Issue:** "Date parsing fails"

```typescript
// Safari doesn't parse all date formats
// ❌ Bad
new Date('2026-01-27 10:00:00')

// ✅ Good
new Date('2026-01-27T10:00:00.000Z')
```

## Development Environment Issues

### Issue: "Hot reload not working"

**Symptoms:**
- Changes don't appear without manual refresh
- Fast Refresh fails

**Solutions:**

1. **Check Next.js version:**

```bash
npm list next  # Should be 15.x
```

2. **Ensure proper import paths:**

```typescript
// ❌ Bad - breaks Fast Refresh
import { Button } from '../../../components/ui/button';

// ✅ Good - use absolute imports
import { Button } from '@/components/ui/button';
```

3. **Restart dev server:**

```bash
pkill -f "next-server"
npm run dev
```

4. **Clear cache:**

```bash
rm -rf .next
npm run dev
```

### Issue: "Port already in use"

**Symptoms:**
- `Error: listen EADDRINUSE: address already in use :::3000`

**Solutions:**

```bash
# Find process using port 3000
lsof -i :3000

# Kill the process
kill -9 <PID>

# Or use a different port
PORT=3001 npm run dev
```

## Logging and Debugging

### Enable Debug Logging

```bash
# In .env.local
LOG_LEVEL=debug
DEBUG=a2a:*,chat:*,usecase:*

# Restart server
npm run dev
```

### Browser Console Debugging

```javascript
// Enable verbose logging
localStorage.setItem('debug', 'caipe:*');

// View all A2A messages
window.addEventListener('a2a-message', (e) => {
  console.log('A2A:', e.detail);
});

// Monitor state changes
const store = useChatStore.getState();
console.log('Chat state:', store);
```

### Network Debugging

```bash
# Use Charles Proxy or mitmproxy
# to inspect HTTP/SSE traffic

# Or use curl with verbose output
curl -v http://localhost:3000/api/chat
```

## Getting Help

### Before Asking for Help

1. **Check logs:**
   ```bash
   # UI logs (in terminal)
   # Browser console (F12)
   # Docker logs
   docker logs caipe-ui --tail 100
   ```

2. **Search existing issues:**
   - [GitHub Issues](https://github.com/cnoe-io/ai-platform-engineering/issues)

3. **Reproduce in clean environment:**
   ```bash
   rm -rf node_modules .next
   npm install
   npm run dev
   ```

### Reporting Issues

When opening an issue, include:

1. **Environment:**
   - OS and version
   - Node.js version (`node --version`)
   - npm version (`npm --version`)
   - Browser and version

2. **Steps to reproduce:**
   - Exact commands run
   - Expected behavior
   - Actual behavior

3. **Logs:**
   - Terminal output
   - Browser console errors
   - Network tab screenshots

4. **Configuration:**
   ```bash
   # Sanitize sensitive data!
   cat ui/.env.local | sed 's/SECRET=.*/SECRET=***/'
   ```

### Community Support

- **GitHub Discussions**: [Discussions](https://github.com/cnoe-io/ai-platform-engineering/discussions)
- **CNOE Community**: [cnoe.io](https://cnoe.io)
- **Slack**: Join CNOE Slack (link in README)

## Common Error Messages

### "Failed to fetch"

**Cause:** Network request failed (CORS, connection refused, timeout)

**Check:**
1. CAIPE supervisor is running
2. CAIPE_URL is correct
3. No CORS issues
4. Network connectivity

### "Session expired"

**Cause:** NextAuth session expired or invalid

**Fix:**
1. Clear cookies
2. Login again
3. Check NEXTAUTH_SECRET

### "Rate limit exceeded"

**Cause:** Too many requests in short time

**Fix:**
1. Wait for rate limit reset
2. Implement exponential backoff
3. Contact admin to increase limits

### "WebSocket connection failed"

**Cause:** WebSocket/SSE not supported or blocked

**Fix:**
1. Check browser compatibility
2. Disable browser extensions
3. Check proxy/firewall rules

## Advanced Debugging

### Trace A2A Protocol Flow

```typescript
// Add logging middleware
const originalFetch = window.fetch;
window.fetch = async (...args) => {
  console.log('Fetch:', args);
  const response = await originalFetch(...args);
  console.log('Response:', response);
  return response;
};
```

### Profile Performance

```javascript
// Start profiling
performance.mark('start');

// ... code to profile ...

// End profiling
performance.mark('end');
performance.measure('operation', 'start', 'end');
const measure = performance.getEntriesByName('operation')[0];
console.log(`Duration: ${measure.duration}ms`);
```

### Memory Profiling

```javascript
// Take heap snapshot in Chrome DevTools
// Memory tab > Take snapshot

// Or use Chrome DevTools Protocol
// chrome://inspect
```

## Next Steps

- [Development Guide](development.md) - Development setup
- [Configuration Guide](configuration.md) - Configuration options
- [API Reference](api-reference.md) - API documentation

---

**Still having issues?** Open an issue on GitHub with detailed information about your problem.
