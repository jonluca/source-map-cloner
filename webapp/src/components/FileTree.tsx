import { useState, useEffect } from "react";

interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
  path?: string;
}

interface FileTreeProps {
  data: TreeNode;
  onFileSelect?: (path: string) => void;
  searchQuery?: string;
  isFullscreen?: boolean;
}

export function FileTree({ data, onFileSelect, searchQuery = "", isFullscreen = false }: FileTreeProps) {
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const toggleNode = (path: string) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
    }
    setExpandedNodes(newExpanded);
  };

  const handleFileClick = (path: string) => {
    setSelectedPath(path);
    if (onFileSelect) {
      onFileSelect(path);
    }
  };

  const sortNodes = (nodes: TreeNode[]): TreeNode[] => {
    return [...nodes].sort((a, b) => {
      // Directories come first
      if (a.type === "directory" && b.type === "file") {
        return -1;
      }
      if (a.type === "file" && b.type === "directory") {
        return 1;
      }
      // Then sort alphabetically
      return a.name.localeCompare(b.name);
    });
  };

  // Filter nodes based on search query
  const filterNodes = (node: TreeNode): TreeNode | null => {
    const query = searchQuery.toLowerCase();

    if (!query) {
      return node;
    }

    if (node.type === "file") {
      // Check if file name or path matches
      if (node.name.toLowerCase().includes(query) || node.path?.toLowerCase().includes(query)) {
        return node;
      }
      return null;
    }

    // For directories, check children
    if (node.children) {
      const filteredChildren = node.children.map((child) => filterNodes(child)).filter((child) => child !== null);

      if (filteredChildren.length > 0) {
        return {
          ...node,
          children: filteredChildren,
        };
      }
    }

    return null;
  };

  // Auto-expand all nodes when searching
  useEffect(() => {
    if (searchQuery) {
      // Expand all directories when searching
      const expandAll = (node: TreeNode, path = ""): string[] => {
        const currentPath = path ? `${path}/${node.name}` : node.name;
        const paths: string[] = [];

        if (node.type === "directory" && node.children) {
          paths.push(currentPath);
          node.children.forEach((child) => {
            paths.push(...expandAll(child, currentPath));
          });
        }

        return paths;
      };

      const allPaths = data.children ? data.children.flatMap((child) => expandAll(child)) : [];
      setExpandedNodes(new Set(allPaths));
    }
  }, [searchQuery, data]);

  const renderNode = (node: TreeNode, path = "", depth = 0) => {
    // Apply filter
    const filteredNode = filterNodes(node);
    if (searchQuery && !filteredNode) {
      return null;
    }
    const currentPath = path ? `${path}/${node.name}` : node.name;
    const isExpanded = expandedNodes.has(currentPath);
    const isSelected = selectedPath === node.path;

    return (
      <div key={currentPath}>
        <div
          className={`flex cursor-pointer items-center px-2 py-1 hover:bg-gray-800 ${isSelected ? "bg-gray-800" : ""}`}
          style={{ paddingLeft: `${depth * 20 + 8}px` }}
          onClick={() => {
            if (node.type === "directory") {
              toggleNode(currentPath);
            } else if (node.path) {
              handleFileClick(node.path);
            }
          }}
        >
          <span className="mr-2 text-gray-400">
            {node.type === "directory" ? (
              isExpanded ? (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              ) : (
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )
            ) : (
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </span>
          <span className={`text-sm ${node.type === "file" ? "text-gray-300" : "font-medium text-gray-400"}`}>
            {node.name}
          </span>
        </div>
        {node.type === "directory" && isExpanded && node.children && (
          <div>{sortNodes(node.children).map((child) => renderNode(child, currentPath, depth + 1))}</div>
        )}
      </div>
    );
  };

  if (!data.children || data.children.length === 0) {
    return <div className="p-4 text-gray-400">No files found</div>;
  }

  const filteredData = searchQuery ? filterNodes(data) : data;

  if (searchQuery && (!filteredData?.children || filteredData.children.length === 0)) {
    return (
      <div
        className={`${isFullscreen ? "flex-1" : "h-[400px]"} flex w-full items-center justify-center overflow-auto rounded-lg border border-gray-700 bg-gray-900`}
      >
        <div className="text-center text-gray-400">
          <p>No files matching "{searchQuery}"</p>
          <p className="mt-2 text-sm">Try a different search term</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`${isFullscreen ? "flex-1" : "h-[400px]"} w-full overflow-auto rounded-lg border border-gray-700 bg-gray-900`}
    >
      <div className="py-2">{sortNodes(filteredData?.children || []).map((child) => renderNode(child))}</div>
    </div>
  );
}
