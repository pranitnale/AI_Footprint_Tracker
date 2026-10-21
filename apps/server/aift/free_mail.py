"""
Email providers anyone can sign up with. Such a domain never names an organization: registering it
would make the registrant administrator of every person who connects with an address there.

The list is data only. Add a provider's exact domain to FREE_MAIL_DOMAINS, or its brand label to
FREE_MAIL_BRANDS when the provider runs the same service under many country domains.
"""

FREE_MAIL_DOMAINS = frozenset(
    {
        # Google, Microsoft, Apple, Yahoo and AOL
        "gmail.com",
        "googlemail.com",
        "outlook.com",
        "hotmail.com",
        "live.com",
        "msn.com",
        "passport.com",
        "icloud.com",
        "me.com",
        "mac.com",
        "aol.com",
        "aim.com",
        # Privacy-focused providers
        "proton.me",
        "pm.me",
        "protonmail.com",
        "protonmail.ch",
        "tuta.io",
        "tuta.com",
        "tutamail.com",
        "tutanota.com",
        "tutanota.de",
        "keemail.me",
        "posteo.de",
        "posteo.net",
        "mailbox.org",
        "startmail.com",
        "runbox.com",
        "hushmail.com",
        "disroot.org",
        "riseup.net",
        "duck.com",
        "fastmail.com",
        "fastmail.fm",
        "hey.com",
        "zoho.com",
        "zohomail.com",
        "zohomail.eu",
        # German-speaking countries
        "gmx.de",
        "gmx.net",
        "gmx.at",
        "gmx.ch",
        "gmx.com",
        "gmx.eu",
        "web.de",
        "t-online.de",
        "freenet.de",
        "arcor.de",
        "online.de",
        "email.de",
        "mail.de",
        "vodafonemail.de",
        "bluewin.ch",
        # Other European providers
        "mail.com",
        "email.com",
        "orange.fr",
        "wanadoo.fr",
        "free.fr",
        "sfr.fr",
        "laposte.net",
        "libero.it",
        "virgilio.it",
        "tiscali.it",
        "seznam.cz",
        "wp.pl",
        "o2.pl",
        "onet.pl",
        "interia.pl",
        "btinternet.com",
        "sky.com",
        "virginmedia.com",
        "ziggo.nl",
        "telenet.be",
        "skynet.be",
        "mail.ru",
        "inbox.ru",
        "list.ru",
        "bk.ru",
        "rambler.ru",
        "ya.ru",
        # North America, Asia and Oceania
        "comcast.net",
        "verizon.net",
        "att.net",
        "sbcglobal.net",
        "bellsouth.net",
        "cox.net",
        "charter.net",
        "earthlink.net",
        "juno.com",
        "shaw.ca",
        "rogers.com",
        "bigpond.com",
        "optusnet.com.au",
        "qq.com",
        "163.com",
        "126.com",
        "naver.com",
        "daum.net",
        "rediffmail.com",
        "lycos.com",
        "inbox.com",
        # Disposable addresses
        "mailinator.com",
        "yopmail.com",
        "guerrillamail.com",
        "10minutemail.com",
        "temp-mail.org",
    }
)

# Brands that run one free service under many country domains, such as yahoo.de, yahoo.co.uk,
# hotmail.fr or yandex.com.tr. Only the brand label followed by a public suffix of at most two short
# labels matches, so live.example.com or a company called yahoo-partner.de does not.
FREE_MAIL_BRANDS = frozenset(
    {
        "yahoo",
        "ymail",
        "rocketmail",
        "hotmail",
        "outlook",
        "live",
        "windowslive",
        "yandex",
        "tutanota",
        "gmx",
        "aol",
        "googlemail",
        "gmail",
        "protonmail",
    }
)


def is_free_mail(domain):
    """True when the normalized domain belongs to a free email provider."""
    domain = domain.lower().rstrip(".")
    if domain in FREE_MAIL_DOMAINS:
        return True
    brand, _, suffix = domain.partition(".")
    labels = suffix.split(".") if suffix else []
    return (
        brand in FREE_MAIL_BRANDS
        and 1 <= len(labels) <= 2
        and all(1 <= len(label) <= 3 and label.isalpha() for label in labels)
    )
