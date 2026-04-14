CREATE TABLE probekit_leads (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  problem TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE probekit_reports (
  id UUID PRIMARY KEY,
  lead_id UUID REFERENCES probekit_leads(id),
  content TEXT NOT NULL,
  search_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_probekit_leads_ip ON probekit_leads(ip_address, created_at);
CREATE INDEX idx_probekit_leads_email ON probekit_leads(email);
