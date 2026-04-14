CREATE TABLE leads (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  problem TEXT NOT NULL,
  ip_address TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE reports (
  id UUID PRIMARY KEY,
  lead_id UUID REFERENCES leads(id),
  content TEXT NOT NULL,
  search_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_leads_ip_created ON leads(ip_address, created_at);
CREATE INDEX idx_leads_email ON leads(email);
