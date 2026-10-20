import { describe, expect, it } from "vitest";
import { extensionOf, postShareCaption, shareFileName, shareFileType, whatsappCaption, whatsappTextLink } from "@/lib/share/whatsapp";

describe("whatsappCaption", () => {
  it("keeps the price, phone number and place word for word", () => {
    const text = "New Ankara dresses are in! 🌸\n\nPrice: 25,000 RWF\n📞 0788 123 456\n📍 Kigali Heights, 2nd floor";
    expect(whatsappCaption({ text })).toBe(text);
  });

  it("drops lines of hashtags and keeps the word of an inline hashtag", () => {
    expect(whatsappCaption({ text: "Fresh bread every morning in #Kigali.\n\n#bakery #kigalifood #rwanda" })).toBe("Fresh bread every morning in Kigali.");
  });

  it("drops 'link in bio' sentences and adds the post's link at the end", () => {
    expect(whatsappCaption({ text: "Order today. Tap the link in our bio! Delivery in Kigali.", link: "https://shop.example/a15" })).toBe("Order today. Delivery in Kigali.\n\nhttps://shop.example/a15");
    expect(whatsappCaption({ text: "Order here: https://shop.example/a15", link: "https://shop.example/a15" })).toBe("Order here: https://shop.example/a15");
  });

  it("puts the title first and never leaves a run of empty lines", () => {
    expect(whatsappCaption({ title: "Weekend offer", text: "Two for one.\n\n#offer\n\n\nCall 0788 123 456" })).toBe("Weekend offer\n\nTwo for one.\n\nCall 0788 123 456");
  });

  it("drops hashtags that close a sentence, and keeps one that is part of it", () => {
    expect(whatsappCaption({ text: "Open late tonight! #kigali\nCome to #Remera" })).toBe("Open late tonight!\nCome to Remera");
    expect(whatsappCaption({ text: "Open late tonight #kigali #remera" })).toBe("Open late tonight");
  });

  it("keeps numbers written with a hash sign", () => {
    expect(whatsappCaption({ text: "Our #1 seller" })).toBe("Our #1 seller");
  });
});

describe("postShareCaption", () => {
  it("shares a video post's caption, not its script", () => {
    expect(postShareCaption({ format: "SCRIPT", title: null, text: "[0-3s] Close-up of the shoes\nVOICE: New shoes, 30,000 RWF", excerpt: "New shoes in store, 30,000 RWF. #shoes" })).toBe("New shoes in store, 30,000 RWF.");
  });

  it("falls back to the script's spoken lines", () => {
    const caption = postShareCaption({ format: "SCRIPT", title: null, text: "0:00 - 0:03 New shoes in store\n0:03 - 0:06 Only 30,000 RWF" });
    expect(caption).toContain("New shoes in store");
    expect(caption).toContain("30,000 RWF");
    expect(caption).not.toMatch(/0:0/);
  });

  it("shares a picture post's title and text", () => {
    expect(postShareCaption({ format: "IMAGE", title: "Open Sunday", text: "We are open 9 to 5.\n#kigali" })).toBe("Open Sunday\n\nWe are open 9 to 5.");
  });
});

describe("files and links", () => {
  it("opens WhatsApp with the text encoded", () => {
    expect(whatsappTextLink("Price: 25,000 RWF & delivery")).toBe("https://wa.me/?text=Price%3A%2025%2C000%20RWF%20%26%20delivery");
  });

  it("reads the extension of stored paths and signed links", () => {
    expect(extensionOf("biz/1/post.JPG")).toBe("jpg");
    expect(extensionOf("https://x.supabase.co/storage/v1/object/sign/gallery-videos/a/b.mp4?token=abc.def")).toBe("mp4");
    expect(extensionOf("no-extension")).toBe("");
  });

  it("gives each file a type phones accept", () => {
    expect(shareFileType("a.webp", "application/octet-stream")).toBe("image/webp");
    expect(shareFileType("a.bin", "image/png; charset=binary")).toBe("image/png");
    expect(shareFileType("clip.mp4", "")).toBe("video/mp4");
  });

  it("names files plainly, numbered when there are several", () => {
    expect(shareFileName("biz/1/x.png", 0, 1, "post")).toBe("bupulse-post.png");
    expect(shareFileName("biz/1/x.jpg", 1, 3, "post")).toBe("bupulse-post-2.jpg");
    expect(shareFileName("https://s/v/clip?token=1", 0, 1, "video")).toBe("bupulse-video.mp4");
  });
});
