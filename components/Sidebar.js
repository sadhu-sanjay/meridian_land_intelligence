export default function Sidebar({ searchValue, onSearchChange }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <p className="eyebrow">Search</p>
        <div className="searchrow">
          <input
            id="searchInput"
            type="text"
            placeholder="Search parcel, zoning, corridor…"
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
          />
        </div>
      </div>
    </aside>
  );
}
