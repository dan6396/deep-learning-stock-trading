import { useState } from "react";
import { Link } from "react-router-dom";
import { Menu, X } from "lucide-react";

const navItems = [
  { label: "Market", href: "#market" },
  { label: "Strategy", href: "#strategy" },
  { label: "Automation", href: "#automation" },
  { label: "Risk", href: "#risk" },
  { label: "Reports", href: "#reports" },
];

export function FloatingNav() {
  const [isMenuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <header className="site-header">
      <nav className="floating-nav" aria-label="주요 메뉴">
        <a className="brand-mark" href="#top" aria-label="AI Trading Desk 홈" onClick={closeMenu}>
          <span className="brand-symbol" aria-hidden="true">
            A
          </span>
          <span>AI Trading Desk</span>
        </a>

        <ul className="nav-links">
          {navItems.map((item) => (
            <li key={item.label}>
              <a href={item.href}>{item.label}</a>
            </li>
          ))}
        </ul>

        <div className="nav-actions">
          <Link className="pill-button pill-button--primary" state={{ resetAnalysis: true }} to="/dashboard">
            대시보드 시작하기
          </Link>
          <button
            className="icon-button nav-menu"
            type="button"
            aria-label={isMenuOpen ? "메뉴 닫기" : "메뉴 열기"}
            aria-controls="mobile-menu"
            aria-expanded={isMenuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            {isMenuOpen ? <X aria-hidden="true" size={20} /> : <Menu aria-hidden="true" size={20} />}
          </button>
        </div>
      </nav>

      {isMenuOpen ? (
        <nav className="mobile-menu" id="mobile-menu" aria-label="모바일 메뉴">
          {navItems.map((item) => (
            <a key={item.label} href={item.href} onClick={closeMenu}>
              {item.label}
            </a>
          ))}
          <Link className="pill-button pill-button--primary" state={{ resetAnalysis: true }} to="/dashboard" onClick={closeMenu}>
            대시보드 시작하기
          </Link>
        </nav>
      ) : null}
    </header>
  );
}
