// Kanaladaptrar (specifikationen 9.2). Annonsstudion anpassar sig efter vad varje kanal
// deklarerar, aldrig efter hårdkodade antaganden. Värden som beror på kanalernas aktuella
// regler är konfiguration och ska verifieras innan R1 lanseras (öppen fråga Q-03) –
// därför är verified = false tills någon har kontrollerat dem.

export type PublishModeId = "manual" | "browser_agent" | "api";
export type ListingKind = "sell" | "give" | "exchange" | "lend" | "wanted" | "help_wanted";

export interface ChannelAdapter {
  id: string;
  name: string;
  /** Webbadress där en ny annons skapas (öppnas i ny flik vid manuell publicering). */
  new_listing_url: string;
  /** Mönster som en inklistrad annonslänk ska matcha. */
  url_pattern: string;
  max_images: number;
  title_max_length: number;
  text_max_length: number;
  supports_price: boolean;
  supports_free: boolean;
  listing_types: ListingKind[];
  publish_modes: PublishModeId[];
  supports_status_sync: boolean;
  /** VRETA-kategori → kanalens kategori. */
  categories: Record<string, string>;
  /** Hashtaggar eller avslutning som passar kanalen. */
  footer: string;
  verified: boolean;
}

export const CHANNEL_ADAPTERS: ChannelAdapter[] = [
  {
    id: "blocket",
    name: "Blocket",
    new_listing_url: "https://www.blocket.se/",
    url_pattern: "^https://(www\\.)?blocket\\.se/",
    max_images: 10,
    title_max_length: 50,
    text_max_length: 3000,
    supports_price: true,
    supports_free: true,
    listing_types: ["sell", "give", "wanted"],
    publish_modes: ["manual", "browser_agent"],
    supports_status_sync: false,
    categories: {
      "Fönster och dörrar": "Bygg & renovering › Fönster & dörrar",
      "Byggnadsdelar": "Bygg & renovering › Övrigt",
      "Tegel och sten": "Bygg & renovering › Byggmaterial",
      "Trä och virke": "Bygg & renovering › Byggmaterial",
      "Beslag och smide": "Bygg & renovering › Övrigt",
      "Kakel och ugnar": "Bygg & renovering › Övrigt",
      "Belysning och el": "Möbler & inredning › Belysning",
      "Möbler och inredning": "Möbler & inredning",
      "Växter": "Trädgård › Växter",
      "Verktyg och maskiner": "Verktyg & maskiner",
      "Trädgård och utemiljö": "Trädgård",
    },
    footer: "Hämtas på plats. Swish eller kontant.",
    verified: false,
  },
  {
    id: "facebook_marketplace",
    name: "Facebook Marketplace",
    new_listing_url: "https://www.facebook.com/marketplace/create/item",
    url_pattern: "^https://(www\\.|m\\.)?facebook\\.com/",
    max_images: 10,
    title_max_length: 100,
    text_max_length: 5000,
    supports_price: true,
    supports_free: true,
    listing_types: ["sell", "give"],
    publish_modes: ["manual", "browser_agent"],
    supports_status_sync: false,
    categories: {
      "Fönster och dörrar": "Hem › Renovering",
      "Byggnadsdelar": "Hem › Renovering",
      "Tegel och sten": "Hem › Renovering",
      "Trä och virke": "Hem › Renovering",
      "Beslag och smide": "Hem › Renovering",
      "Kakel och ugnar": "Hem › Renovering",
      "Belysning och el": "Hem › Inredning",
      "Möbler och inredning": "Hem › Möbler",
      "Växter": "Trädgård",
      "Verktyg och maskiner": "Hem › Verktyg",
      "Trädgård och utemiljö": "Trädgård",
    },
    footer: "Hämtas på plats.",
    verified: false,
  },
  {
    id: "facebook_group",
    name: "Facebookgrupp",
    new_listing_url: "https://www.facebook.com/groups/",
    url_pattern: "^https://(www\\.|m\\.)?facebook\\.com/groups/",
    max_images: 10,
    title_max_length: 120,
    text_max_length: 5000,
    supports_price: true,
    supports_free: true,
    listing_types: ["sell", "give", "exchange", "lend", "wanted", "help_wanted"],
    publish_modes: ["manual"],
    supports_status_sync: false,
    categories: {},
    footer: "#återbruk #byggnadsvård",
    verified: false,
  },
  {
    id: "tiptapp",
    name: "Tiptapp",
    new_listing_url: "https://www.tiptapp.se/",
    url_pattern: "^https://(www\\.)?tiptapp\\.(se|com)/",
    max_images: 5,
    title_max_length: 60,
    text_max_length: 1000,
    supports_price: true,
    supports_free: true,
    listing_types: ["give"],
    publish_modes: ["manual"],
    supports_status_sync: false,
    categories: {},
    footer: "",
    verified: false,
  },
];

export function adapter(id: string): ChannelAdapter | undefined {
  return CHANNEL_ADAPTERS.find((c) => c.id === id);
}

export function adaptersFor(type: ListingKind): ChannelAdapter[] {
  return CHANNEL_ADAPTERS.filter((c) => c.listing_types.includes(type));
}
