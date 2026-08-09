import SearchBar from "@/components/SearchBar";

export default function Sidebar({ searchValue, onSearchChange, onSearchSelect }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <p className="eyebrow">Search</p>
        <div className="searchrow">
          <SearchBar
            value={searchValue}
            onChange={onSearchChange}
            onSelect={onSearchSelect}
          />
        </div>
      </div>
    </aside>
  );
}
