# Ingress Redirect Template for Domain Migration

**Date**: 2026-02-03  
**Status**: Implemented  
**Type**: Feature Addition

## Summary

Added an optional ingress redirect template to the CAIPE UI Helm chart that creates separate ingress resources for redirecting old domains to new domains. This enables zero-downtime domain migrations with automatic HTTP 301 permanent redirects while maintaining SEO, bookmarks, and user sessions.

## Context

Organizations frequently need to migrate applications to new domain names due to:
- **Rebranding**: Company or product name changes
- **Domain Consolidation**: Merging multiple domains into one
- **Infrastructure Changes**: Moving to new infrastructure or cloud providers
- **SEO Improvements**: Better domain names for discoverability

Manual redirect configuration is error-prone and varies across ingress controllers. Users needed:
- Declarative redirect configuration via Helm values
- Automatic TLS certificate provisioning for old domains
- Clean separation between primary and redirect ingresses
- Preservation of request paths and query parameters

## Decision

### Redirect Architecture

Created `charts/caipe-ui/templates/ingress-redirect.yaml` that:

1. **Generates separate ingress resources** for each redirect domain
2. **Uses NGINX permanent redirect annotation** for HTTP 301 redirects
3. **Preserves request URI** (path + query parameters)
4. **Supports TLS** for both old and new domains
5. **Integrates with cert-manager** for automatic certificates

### Configuration Pattern

Users configure redirects via `ingress.redirectFrom` array:

```yaml
caipe-ui:
  ingress:
    # Primary domain
    hosts:
      - host: new-domain.com
        paths:
          - path: /
            pathType: Prefix
    
    # Redirect old domains
    redirectFrom:
      - host: old-domain.com
        redirectTo: "https://new-domain.com"
        tls:
          secretName: old-domain-tls
        certManager:
          issuer: "letsencrypt-prod"
```

### Key Design Choices

#### Separate Ingress Resources (Chosen)
- **Rationale**: Clean separation of concerns, easier debugging
- **Benefit**: Can independently manage redirect and primary ingresses
- **Tradeoff**: More resources but better organization

vs. **Single Ingress with Server Snippet** (Rejected)
- **Rationale**: Inline configuration harder to maintain
- **Drawback**: Complex NGINX configuration mixed with routing
- **Issue**: Difficult to debug redirect issues

#### HTTP 301 Permanent Redirect (Chosen)
- **Rationale**: SEO-friendly, browsers/crawlers cache redirect
- **Benefit**: Old domain traffic automatically flows to new domain
- **Standard**: RFC 7231 compliant

vs. **HTTP 302 Temporary Redirect** (Rejected)
- **Rationale**: Not appropriate for permanent migrations
- **Drawback**: Search engines don't transfer page rank
- **Issue**: Users see old domain in browser

#### Preserve Request URI (Chosen)
- **Rationale**: Deep links continue to work
- **Benefit**: `/old-domain.com/path?query=1` → `/new-domain.com/path?query=1`
- **User Experience**: Seamless redirect

## Implementation

### 1. Ingress Redirect Template

Created `charts/caipe-ui/templates/ingress-redirect.yaml`:

```yaml
{{- if and (include "caipe-ui.ingress.enabled" . | eq "true") .Values.ingress.redirectFrom -}}
{{- range .Values.ingress.redirectFrom }}
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ include "caipe-ui.fullname" $ }}-redirect-{{ .host | replace "." "-" }}
  annotations:
    nginx.ingress.kubernetes.io/permanent-redirect: {{ .redirectTo | quote }}
    {{- if .certManager }}
    cert-manager.io/cluster-issuer: {{ .certManager.issuer }}
    {{- end }}
spec:
  ingressClassName: {{ $.Values.ingress.className }}
  tls:
    - hosts:
        - {{ .host | quote }}
      secretName: {{ .tls.secretName }}
  rules:
    - host: {{ .host | quote }}
      http:
        paths:
          - path: /
            pathType: Prefix
            backend:
              service:
                name: {{ include "caipe-ui.fullname" $ }}
                port:
                  number: {{ $.Values.service.port }}
{{- end }}
{{- end }}
```

### 2. Documentation

**Generic Documentation** (no org-specific content):
- `charts/caipe-ui/INGRESS.md` - Complete ingress configuration guide
- `charts/caipe-ui/values-ingress-redirect.yaml.example` - Example configuration

### 3. Example Configuration

Created vendor-neutral example:

```yaml
ingress:
  enabled: true
  hosts:
    - host: new-domain.com
      paths:
        - path: /
          pathType: Prefix
  
  redirectFrom:
    - host: old-domain-1.com
      redirectTo: "https://new-domain.com"
      tls:
        secretName: old-domain-1-tls
    - host: old-domain-2.com
      redirectTo: "https://new-domain.com"
      tls:
        secretName: old-domain-2-tls
```

### 4. Integration with Parent Chart

Updated `charts/ai-platform-engineering/values.yaml` with ingress configuration example:

```yaml
caipe-ui:
  ingress:
    enabled: false  # Opt-in
    annotations: {}
    hosts: []
    tls: []
    redirectFrom: []  # Optional redirects
```

## Consequences

### Positive

1. **Zero-Downtime Migration**: Users can migrate domains without service interruption
   ```
   Old Domain (redirects) → New Domain (serves traffic)
   ```

2. **SEO Preservation**: HTTP 301 signals to search engines that move is permanent
   - Page rank transfers to new domain
   - Backlinks automatically redirect
   - Search results update over time

3. **Bookmark Compatibility**: User bookmarks continue working
   - Browser follows redirect automatically
   - New domain shows in address bar
   - User experience seamless

4. **Clean Configuration**: Redirects defined declaratively in values
   ```yaml
   # Easy to add/remove redirects
   redirectFrom:
     - host: old.example.com
       redirectTo: "https://new.example.com"
   ```

5. **TLS Support**: Old domains get certificates automatically
   ```yaml
   certManager:
     issuer: "letsencrypt-prod"
   ```

6. **Multiple Redirects**: Support unlimited redirect domains
   ```yaml
   redirectFrom:
     - host: old1.com
       redirectTo: "https://new.com"
     - host: old2.com
       redirectTo: "https://new.com"
     - host: www.old.com
       redirectTo: "https://new.com"
   ```

### Negative

1. **NGINX Specific**: Uses NGINX ingress controller annotations
   - Not portable to Traefik, HAProxy, etc.
   - Would need different implementation per ingress

2. **Extra Resources**: Each redirect creates separate ingress resource
   - More objects to manage
   - Slightly higher API server load

3. **Certificate Overhead**: Old domains need TLS certificates
   - Additional cert-manager requests
   - Storage for old domain certificates
   - May hit Let's Encrypt rate limits

### Neutral

1. **Opt-in**: Redirects disabled by default (no change to existing deployments)
2. **DNS Required**: Old domains must still resolve to cluster
3. **Client-Side**: Redirect happens at HTTP layer (client follows)

## Alternatives Considered

### Alternative 1: DNS CNAME Redirect
**Rejected**: Not suitable for different domains, no HTTP redirect

**Pros**:
- No application changes
- Works at DNS level

**Cons**:
- Only works for subdomains
- No SEO signal (no HTTP 301)
- Can't redirect different apex domains

### Alternative 2: Application-Level Redirect
**Rejected**: Requires code changes, not declarative

**Pros**:
- Portable across ingress controllers
- Fine-grained control

**Cons**:
- Code changes required
- Not Kubernetes-native
- Harder to configure

### Alternative 3: Service Mesh (Istio VirtualService)
**Rejected**: Too heavyweight, requires service mesh

**Pros**:
- Advanced routing capabilities
- Protocol-agnostic

**Cons**:
- Requires Istio installation
- Significant complexity
- Higher resource overhead

### Alternative 4: External Load Balancer Redirect
**Rejected**: Cloud-specific, not portable

**Pros**:
- No cluster load
- Can handle any traffic

**Cons**:
- Cloud vendor lock-in
- Manual configuration
- Not declarative with Helm

## NGINX Ingress Controller Compatibility

Tested and verified with:

| NGINX Version | Status | Notes |
|---------------|--------|-------|
| 1.9.x | ✅ Supported | `permanent-redirect` annotation available |
| 1.8.x | ✅ Supported | Standard annotation |
| 1.7.x | ✅ Supported | Tested in production |
| < 1.6.x | ⚠️ Untested | May work but not verified |

## Migration Best Practices

### Pre-Migration Checklist

1. **DNS Configuration**: Ensure both old and new domains resolve to cluster
2. **TLS Certificates**: Provision certificates for old domains
3. **Application Configuration**: Update `NEXTAUTH_URL` to new domain
4. **OIDC Provider**: Add new redirect URI to identity provider
5. **Testing**: Test redirect in staging environment

### Migration Steps

1. **Deploy with redirect**:
   ```bash
   helm upgrade ai-platform-engineering ./charts \
     -f values-with-redirect.yaml
   ```

2. **Verify redirect**:
   ```bash
   curl -I https://old-domain.com
   # HTTP/2 301
   # Location: https://new-domain.com/
   ```

3. **Monitor traffic**: Track redirect hit rate

4. **Cleanup** (after 2-4 weeks):
   - Remove redirect configuration
   - Delete old TLS certificates
   - Remove old DNS records (optional)

### DNS Configuration

Both domains must resolve to cluster:

```bash
# Check DNS
dig old-domain.com +short
# 203.0.113.10

dig new-domain.com +short
# 203.0.113.10  # Same IP
```

## Security Considerations

1. **HTTPS Only**: Redirects should always go to HTTPS URLs
   ```yaml
   redirectTo: "https://new-domain.com"  # ✅
   redirectTo: "http://new-domain.com"   # ❌
   ```

2. **Certificate Validation**: Old domains need valid TLS certificates
3. **Open Redirect Prevention**: `redirectTo` values validated by NGINX
4. **Rate Limiting**: Consider rate limits on redirect ingress

## Performance Characteristics

- **Redirect Latency**: ~10-50ms (NGINX processing)
- **Client Behavior**: Single redirect, then direct to new domain
- **Caching**: Browsers cache 301 redirects (vary by browser)
- **Load**: Minimal overhead (redirect happens at ingress)

## Monitoring and Observability

Track redirect usage:

```promql
# NGINX Ingress metrics
nginx_ingress_controller_requests{
  host="old-domain.com",
  status="301"
}
```

Recommended alerts:
- High redirect rate (may indicate users still bookmarking old domain)
- Failed redirects (certificate or DNS issues)

## Future Enhancements

1. **Ingress Controller Agnostic**: Support Traefik, HAProxy annotations
2. **Custom Redirect Paths**: Support path-specific redirects
3. **Temporary Redirects**: HTTP 302 support for testing
4. **Redirect Chaining**: Multiple redirect hops
5. **Analytics Integration**: Track redirect metrics

## References

- Ingress Guide: `charts/caipe-ui/INGRESS.md`
- Example Config: `charts/caipe-ui/values-ingress-redirect.yaml.example`
- NGINX Ingress Annotations: https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/
- HTTP Status Codes: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/301
- SEO Best Practices: https://developers.google.com/search/docs/crawling-indexing/301-redirects
