# LOON Scaling Guidelines

**Purpose**: Define capacity limits and scaling considerations for LOON deployments  
**Version**: 3.1.0  
**Last Updated**: February 2, 2026

---

## Quick Reference

| Metric | Free Tier Limit | Recommended Capacity | Notes |
|--------|-----------------|----------------------|-------|
| **Concurrent Users** | Unlimited | <100 | Beyond 100, test first |
| **Content Pages** | Unlimited | <1,000 | GitHub repo size concerns |
| **Content Size Per Page** | 1MB | <500KB | 1MB hard limit includes Base64 encoding |
| **Total Repository Size** | 100GB+ | <5GB | GitHub soft limit: 100GB |
| **Edits Per Hour** | Unlimited | <1,000 | GitHub rate limit: 5,000 req/hour |
| **Concurrent Editors** | Unlimited | <10 | Conflict risk increases beyond 10 |
| **KV Storage** | 1GB | <500MB | Auto-cleanup via TTL |
| **Monthly Cost** | $0 | $0 | Forever free on Cloudflare + GitHub free tier |

---

## Capacity Planning

### Small Deployment (< 10 users)

**Use Case**: Department newsletter, small team directory

**Characteristics**:
- 5-20 pages
- 1-5 concurrent editors
- 10-50 edits/day

**No special setup needed**. Deploy as-is.

**Cost**: $0/month

---

### Medium Deployment (10-100 users)

**Use Case**: Organization-wide CMS, newsroom, directory

**Characteristics**:
- 50-500 pages
- 5-20 concurrent editors
- 100-500 edits/day

**Considerations**:
- Test with 10-20 concurrent editors before full rollout
- Monitor GitHub rate limits (target: <2,000 requests/day)
- Backup strategy becomes critical

**Scaling actions**:
1. Set up automated daily backups
2. Monitor KV usage weekly
3. Review audit logs for unusual patterns
4. Create runbook for common operations

**Cost**: $0/month (Cloudflare free tier sufficient)

---

### Large Deployment (> 100 users)

**Use Case**: Enterprise CMS, multiple teams, high-volume publishing

**Characteristics**:
- 500-5,000 pages
- 20-100 concurrent editors
- 500-2,000 edits/day

**Critical considerations**:

1. **GitHub Rate Limits**
   - 5,000 API requests/hour (authenticated)
   - 100 edits/hour = ~100 requests
   - 2,000 edits/day = ~15,000 requests → **Over limit**
   - Request higher limits from GitHub (free for public repos)

2. **Repository Size**
   - 5,000 pages × 100KB avg = 500MB → OK
   - Clone/checkout times may slow down
   - Consider archiving old pages to separate repo

3. **Concurrent Editing**
   - Conflict risk increases with concurrent editors
   - No built-in conflict resolution
   - Train users on avoiding simultaneous edits

4. **KV Operations**
   - 500MB storage + sessions + audit logs
   - Still within 1GB free tier
   - Monitor growth monthly

**Scaling actions**:

1. **Request GitHub Rate Limit Increase**:
   - Email support@github.com
   - Free for public repos, usually granted
   - Can request 10,000+ requests/hour

2. **Implement Usage Limits**:
   - Max file size: 500KB (reduce from 1MB)
   - Rate limiting: 20 requests/minute/IP (reduce from 30)
   - Max audit log retention: 14 days (reduce from 30)

3. **Operational Changes**:
   - Scheduled editing windows (avoid all-day editing)
   - Backup every 6 hours (not just daily)
   - Dedicated admin for GitHub token management
   - Weekly audit log reviews

4. **Architecture Considerations**:
   - Consider splitting into multiple LOON instances by team
   - Use GitHub organization for better access control
   - Implement content versioning/approval workflow

---

## Performance Characteristics

### Response Times

**Under normal load** (10 users, 1-5 edits/day):
- Login: 500-1,500ms (PBKDF2 hashing is intentionally slow)
- Page load: 200-400ms
- Save: 2,000-5,000ms (includes GitHub API call + retry logic)

**Under heavy load** (50+ concurrent editors):
- Login: May exceed 2,000ms
- Page load: 500-1,000ms
- Save: 5,000-15,000ms (retries add latency)

### Latency Sources

1. **PBKDF2 Hashing** (~100ms per login)
   - 100,000 iterations for security
   - Non-negotiable for password security

2. **GitHub API** (1,000-3,000ms per save)
   - Network round-trip to GitHub
   - Exponential backoff adds latency on failures

3. **Cloudflare Workers** (~50ms processing)
   - Route matching, validation, response building

4. **Browser Rendering** (~100-500ms)
   - Form generation, validation

---

## Bottleneck Analysis

### GitHub API Rate Limits

**Most likely bottleneck** for large deployments.

**Symptoms**:
- Saves fail with "429 Too Many Requests"
- Edits queue up, users see "pending" status
- Error logs show rate limit responses

**Mitigation**:
1. Request higher limits from GitHub
2. Implement client-side save queuing
3. Reduce polling frequency
4. Batch operations

**Example**: 100 users × 10 edits/day = 1,000 saves/day → 1,000 API calls  
**Headroom**: 5,000 requests/hour = 5,000 calls/hour → Still OK

But add audit logging, session checks, content verification:  
1,000 edits × (1 edit + 2 auth checks + 2 audit logs) = 5,000 calls → **At limit**

**Action**: Request increase to 10,000+ requests/hour.

### Concurrent Editing Conflicts

**Problem**: Two users edit same page, last one wins (overwrites first)

**Current behavior**: No conflict resolution

**Impact**:
- Rare in practice (requires simultaneous editing)
- Large deployments: likelihood increases

**Workaround**:
1. Train users on editing discipline
2. Implement scheduling (Monday 10am = content edits window)
3. Use GitHub branch merging for true conflict resolution

**Future enhancement**: Field-level locking, pessimistic concurrency

### KV Storage Limits

**Unlikely bottleneck** unless massive scale.

**Current**:
- 1GB per namespace (free tier)
- Typical: 500MB for 5,000 pages
- Sessions/audit: <100MB with auto-cleanup

**When concerned** (>500MB):
1. Archive old pages
2. Reduce audit log retention
3. Manually clean up old sessions

**Action**: Upgrade to paid plan (if exceeding 1GB)

---

## Testing Recommendations

Before deploying at scale:

### Load Test 1: Concurrent Users

```bash
# Simulate 20 concurrent users logging in
# Tools: Apache JMeter, k6, Locust

# Expected: All logins succeed within 5 seconds
# Failure: Timeouts or rate limiting
```

### Load Test 2: Concurrent Saves

```bash
# Simulate 10 concurrent users saving content
# Expected: All saves succeed within 10 seconds
# Failure: GitHub rate limit hits, some saves fail
```

### Load Test 3: Sustained Load

```bash
# 50 users, normal activity over 1 hour
# 1 login per user
# 3 saves per user spread over hour
# Expected: No failures, <2,000 GitHub API calls
# Failure: Rate limits, timeouts
```

### Load Test 4: Large Content

```bash
# Save 900KB page (near limit)
# Expected: Success within 10 seconds
# Failure: Timeout, size validation error
```

---

## Scaling Checklist

- [ ] Review current deployment metrics
- [ ] Test with expected concurrent users
- [ ] Estimate daily GitHub API calls
- [ ] Request GitHub rate limit increase (if needed)
- [ ] Set up automated backup strategy
- [ ] Configure monitoring (KV, workers, audit logs)
- [ ] Create operational runbook
- [ ] Test disaster recovery procedures
- [ ] Document access controls and permissions
- [ ] Schedule quarterly capacity reviews

---

## Migration Path

### Outgrowing LOON

If LOON no longer meets needs:

1. **Strapi**: More flexible, database-backed, enterprise features
2. **Contentful**: Managed CMS, API-first, expensive but scalable
3. **Custom Next.js + Database**: Full control, requires development

**Export from LOON**:
```bash
# All content is JSON in Git
# Export: git clone, copy data/ folder
# Compatible with any CMS accepting JSON
```

---

## Free Tier Economics

**Monthly cost at scale**:
- Cloudflare Pages: $0 (free tier: 500 deploys/month)
- GitHub: $0 (free tier: unlimited repos, 100GB storage)
- KV Storage: $0 (free tier: 1GB, 3 million reads, 1 million writes)
- Custom domain: $12-20 (not included)

**Total: $0-20/month** (2x cheaper than Strapi, 10x cheaper than Contentful)

---

**Next Review**: August 2, 2026
