"""Rules the review bot applies. Edit these lists to tighten or relax the store policy."""

MAX_APK_MB = 95

# Sensitive permissions: the app is still published, but they are listed on its page.
RISKY_PERMISSIONS = {
    "android.permission.READ_SMS",
    "android.permission.SEND_SMS",
    "android.permission.RECEIVE_SMS",
    "android.permission.RECEIVE_MMS",
    "android.permission.READ_CALL_LOG",
    "android.permission.WRITE_CALL_LOG",
    "android.permission.PROCESS_OUTGOING_CALLS",
    "android.permission.BIND_ACCESSIBILITY_SERVICE",
    "android.permission.BIND_DEVICE_ADMIN",
    "android.permission.SYSTEM_ALERT_WINDOW",
    "android.permission.REQUEST_INSTALL_PACKAGES",
    "android.permission.MANAGE_EXTERNAL_STORAGE",
    "android.permission.QUERY_ALL_PACKAGES",
    "android.permission.READ_CONTACTS",
    "android.permission.RECORD_AUDIO",
    "android.permission.READ_PHONE_NUMBERS",
    "android.permission.BIND_NOTIFICATION_LISTENER_SERVICE",
}

# Package-name prefixes of well known companies: other developers using them are rejected.
PROTECTED_PACKAGE_PREFIXES = (
    "com.google.",
    "com.android.",
    "android.",
    "com.whatsapp",
    "com.facebook.",
    "com.instagram.",
    "org.telegram.",
    "com.samsung.",
    "com.miui.",
    "com.phonepe.",
    "net.one97.paytm",
    "com.amazon.",
    "com.netflix.",
    "com.spotify.",
    "com.snapchat.",
    "com.zhiliaoapp.",
)

# Brand names in an app name are rejected (possible impersonation).
BRAND_NAMES = (
    "whatsapp", "instagram", "facebook", "telegram", "youtube", "google", "netflix",
    "paytm", "phonepe", "gpay", "amazon", "flipkart", "tiktok", "snapchat", "spotify",
    "jio", "airtel", "sbi", "hdfc", "icici", "chrome", "gmail", "twitter", "samsung",
)

# Words that cause an automatic reject in the app name or descriptions.
BLOCKED_WORDS = (
    "porn", "xxx", "nude", "nudes", "sex video", "escort", "hentai", "casino hack",
    "carding", "ddos", "keylogger", "spyware", "stalkerware", "ransomware",
    # abusive language (English / Hindi written in English letters)
    "fuck", "fucking", "bitch", "bastard", "asshole", "motherfucker",
    "madarchod", "behenchod", "bhenchod", "chutiya", "chutiye", "gandu", "harami",
    "bhosdi", "bhosdike", "gaand", "kutta", "kamina",
)

# Piracy / cheating words in the app name or descriptions: rejected.
REVIEW_WORDS = (
    "mod apk", "cracked", "crack", "premium unlocked", "hacked", "hack tool", "free robux",
    "unlimited coins", "unlimited gems", "pirated", "leaked", "watch movies free",
)

# VirusTotal thresholds (number of engines).
VT_REJECT_MALICIOUS = 2   # this many engines say malicious -> rejected
VT_REJECT_SUSPICIOUS = 4  # this many say suspicious -> rejected
