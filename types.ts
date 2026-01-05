

export interface Contact {
  name: string;
  role: string;
  linkedin?: string;
  email?: string;
  phone?: string;
}

export interface Lead {
  // Core Business Info (Discovery Phase)
  name: string;
  website: string;
  niche: string;
  location: string;
  description: string; // Brief description of what they do

  // Enrichment Info (Grok Phase)
  contacts: Contact[];
  company_linkedin?: string;
  company_instagram?: string;

  // Scoring & Status
  score: number;
  rating: "Hot Lead" | "Hidden Gem" | "Prospect" | "Needs Research" | string;
  why_good: string; // Brief reason why they fit the search

  // User State
  isContacted?: boolean;
  isFavorite?: boolean;
  isHidden?: boolean;
}

export type BusinessType =
  | "Any Business"
  // Product-Based
  | "E-commerce Stores"
  | "Food & Beverage Brands"
  | "Fashion & Clothing Brands"
  | "Beauty & Cosmetics"
  | "Handmade & Craft Businesses"
  // Service-Based
  | "Restaurants & Food Services"
  | "Event Management Companies"
  | "Wedding Services"
  | "Real Estate Agencies"
  | "Health & Wellness"
  // Creative
  | "Musicians & Artists"
  | "Authors & Publishers"
  | "Photographers"
  | "Marketing Agencies"
  // Growth
  | "Startups & New Businesses"
  | "Rebranding Companies"
  | "Local Businesses"
  | "Consultants & Coaches"
  | "Tech Startups"
  | "Non-profit Organizations";