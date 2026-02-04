# CAIPE UI Ingress Configuration Guide

**Date**: 2026-02-03
**Status**: Reference Guide
**Type**: Configuration Documentation

## Summary

This document describes the comprehensive ingress configuration options for CAIPE UI, including multiple hostnames, custom annotations, automatic redirects, TLS/SSL support, and path-based routing.

## Features

The CAIPE UI Helm chart supports:

1. **Multiple Hostnames** - Serve the application on multiple domains
2. **Custom Annotations** - Add any NGINX ingress annotations
3. **Automatic Redirects** - Redirect old domains to new domains (useful for migrations)
4. **TLS/SSL Support** - Automatic certificate provisioning with cert-manager
5. **Path-based Routing** - Configure different paths for different hosts

## Basic Configuration

### Single Domain

```yaml
caipe-ui:
  ingress:
    enabled: true
    className: "nginx"
    hosts:
      - host: caipe.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: caipe-example-com-tls
        hosts:
          - caipe.example.com
```

### Multiple Domains

```yaml
caipe-ui:
  ingress:
    enabled: true
    hosts:
      - host: caipe.example.com
        paths:
          - path: /
            pathType: Prefix
      - host: app.example.com
        paths:
          - path: /
            pathType: Prefix
    tls:
      - secretName: caipe-example-com-tls
        hosts:
          - caipe.example.com
      - secretName: app-example-com-tls
        hosts:
          - app.example.com
```

## Annotations

Add NGINX ingress controller annotations for additional functionality:

### SSL/TLS

```yaml
caipe-ui:
  ingress:
    annotations:
      # Automatic certificate provisioning
      cert-manager.io/cluster-issuer: "letsencrypt-prod"

      # Force HTTPS
      nginx.ingress.kubernetes.io/ssl-redirect: "true"
      nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
```

### Security Headers

```yaml
caipe-ui:
  ingress:
    annotations:
      nginx.ingress.kubernetes.io/configuration-snippet: |
        more_set_headers "X-Frame-Options: SAMEORIGIN";
        more_set_headers "X-Content-Type-Options: nosniff";
        more_set_headers "X-XSS-Protection: 1; mode=block";
        more_set_headers "Referrer-Policy: strict-origin-when-cross-origin";
```

### Request Size Limits

```yaml
caipe-ui:
  ingress:
    annotations:
      nginx.ingress.kubernetes.io/proxy-body-size: "100m"
      nginx.ingress.kubernetes.io/proxy-read-timeout: "600"
      nginx.ingress.kubernetes.io/proxy-send-timeout: "600"
```

### Rate Limiting

```yaml
caipe-ui:
  ingress:
    annotations:
      nginx.ingress.kubernetes.io/limit-rps: "100"
      nginx.ingress.kubernetes.io/limit-connections: "50"
```

### CORS

```yaml
caipe-ui:
  ingress:
    annotations:
      nginx.ingress.kubernetes.io/enable-cors: "true"
      nginx.ingress.kubernetes.io/cors-allow-methods: "GET, POST, PUT, DELETE, OPTIONS"
      nginx.ingress.kubernetes.io/cors-allow-origin: "https://example.com"
```

### IP Whitelisting

```yaml
caipe-ui:
  ingress:
    annotations:
      nginx.ingress.kubernetes.io/whitelist-source-range: "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
```

## Domain Redirects

The chart supports automatic redirects from old domains to new domains using the `redirectFrom` configuration. This is useful when:
- Migrating to a new domain name
- Consolidating multiple domains to one
- Maintaining SEO and bookmarks during rebranding

### Configuration

```yaml
caipe-ui:
  ingress:
    enabled: true

    # Primary domain
    hosts:
      - host: new-domain.com
        paths:
          - path: /
            pathType: Prefix

    tls:
      - secretName: new-domain-tls
        hosts:
          - new-domain.com

    # Redirect old domains to new domain
    redirectFrom:
      - host: old-domain.com
        redirectTo: "https://new-domain.com"
        tls:
          secretName: old-domain-tls
        certManager:
          issuer: "letsencrypt-prod"
```

This creates a separate ingress resource that:
1. Accepts traffic on `old-domain.com`
2. Issues an HTTP 301 (permanent redirect) to `https://new-domain.com`
3. Preserves the request path and query parameters

### Multiple Redirects

Redirect multiple old domains to a single new domain:

```yaml
caipe-ui:
  ingress:
    redirectFrom:
      - host: old-domain-1.com
        redirectTo: "https://new-domain.com"
        tls:
          secretName: old-domain-1-tls
      - host: old-domain-2.com
        redirectTo: "https://new-domain.com"
        tls:
          secretName: old-domain-2-tls
      - host: www.old-domain.com
        redirectTo: "https://new-domain.com"
        tls:
          secretName: www-old-domain-tls
```

### Important Notes

When using domain redirects:

1. **Update NEXTAUTH_URL** - Must match the new domain:
   ```yaml
   config:
     NEXTAUTH_URL: "https://new-domain.com"
   ```

2. **Update OIDC Redirect URIs** - Add new domain to your identity provider:
   ```
   https://new-domain.com/api/auth/callback/oidc
   ```

3. **Keep old certificates** - TLS certificates needed for old domains during redirect

4. **DNS Records** - Both old and new domains must resolve to your cluster

5. **Monitor Traffic** - Track redirect usage to determine when to remove old domains

## Path-Based Routing

Route different paths to the same application:

```yaml
caipe-ui:
  ingress:
    hosts:
      - host: example.com
        paths:
          - path: /app
            pathType: Prefix
          - path: /api
            pathType: Prefix
```

## Complete Example

See `values-ingress-redirect.yaml.example` for a complete example configuration.

## Troubleshooting

### Ingress Not Working

```bash
# Check ingress status
kubectl get ingress -n your-namespace

# Describe ingress for events
kubectl describe ingress ai-platform-engineering-caipe-ui -n your-namespace

# Check NGINX ingress controller logs
kubectl logs -n ingress-nginx deployment/ingress-nginx-controller
```

### Certificate Issues

```bash
# Check certificate status
kubectl get certificate -n your-namespace

# Describe certificate
kubectl describe certificate your-domain-tls -n your-namespace

# Check cert-manager logs
kubectl logs -n cert-manager deployment/cert-manager
```

### Redirect Not Working

```bash
# Test redirect
curl -I https://old-domain.com

# Check redirect ingress
kubectl describe ingress ai-platform-engineering-caipe-ui-redirect-old-domain-com -n your-namespace

# Verify annotation
kubectl get ingress ai-platform-engineering-caipe-ui-redirect-old-domain-com -o yaml
```

## References

- [Kubernetes Ingress](https://kubernetes.io/docs/concepts/services-networking/ingress/)
- [NGINX Ingress Controller](https://kubernetes.github.io/ingress-nginx/)
- [NGINX Ingress Annotations](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/)
- [cert-manager](https://cert-manager.io/docs/)
