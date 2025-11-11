import React, { useState, useEffect, useRef } from "react";
import { Pagination, Modal, Radio, Button, Tooltip, Input, Switch } from "antd";
import { SearchOutlined, ClearOutlined } from "@ant-design/icons";
import toast, { Toaster } from "react-hot-toast";
import "./FileList.css";
import { getUserFromToken } from "./auth";

const API_BASE_URL = process.env.REACT_APP_FETCH_API_ENDPOINT;
console.log("API_BASE_URL", API_BASE_URL);

const FileList = () => {
  const [files, setFiles] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [pageSize, setPageSize] = useState(10);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [downloadingFiles, setDownloadingFiles] = useState(new Set());
  const [expandedVersions, setExpandedVersions] = useState(new Set());

  // Search related state
  const [searchQuery, setSearchQuery] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [showVersionsInSearch, setShowVersionsInSearch] = useState(false);
  const [isSearchMode, setIsSearchMode] = useState(false);

  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [uploadType, setUploadType] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const [directoryUploadModalVisible, setDirectoryUploadModalVisible] =
    useState(false);
  const [targetDirectory, setTargetDirectory] = useState("");
  const [directorySelectedFiles, setDirectorySelectedFiles] = useState([]);
  const [directoryUploading, setDirectoryUploading] = useState(false);

  const [versionDownloadModalVisible, setVersionDownloadModalVisible] =
    useState(false);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [downloadingVersion, setDownloadingVersion] = useState(false);

  const [fileComments, setFileComments] = useState({});
  const [showComments, setShowComments] = useState(false);

  const fileInputRef = useRef();
  const folderInputRef = useRef();
  const directoryFileInputRef = useRef();

  // Search functionality
  const performSearch = async (query) => {
    if (!query.trim()) {
      setIsSearchMode(false);
      setSearchResults([]);
      return;
    }

    setIsSearching(true);
    try {
      const searchParams = new URLSearchParams({
        q: query.trim(),
        include_tags: "false",
        max_keys: "1000",
      });

      const response = await fetch(`${API_BASE_URL}/search?${searchParams}`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        throw new Error(
          `Search failed: ${response.status} ${response.statusText}`
        );
      }

      const result = await response.json();
      const searchItems = result.items || [];

      // Fetch lock status for search results
      const lockRes = await fetch(`${API_BASE_URL}/list`).then((r) => r.json());
      const lockMap = {};
      lockRes.forEach((item) => {
        lockMap[item.filename] = {
          locked: item.status === "locked",
          lockedBy: item.locked_by || null,
          timestamp: item.timestamp || null,
        };
      });

      // Map search results to file format
      const searchResultsWithLockInfo = searchItems.map((item) => ({
        fileName: item.key,
        fullPath: item.key,
        locked: lockMap[item.key]?.locked || false,
        lockedBy: lockMap[item.key]?.lockedBy || null,
        timestamp: lockMap[item.key]?.timestamp || null,
        size: item.size,
        lastModified: item.last_modified,
        eTag: item.e_tag,
        isFolder: false,
        isSearchResult: true,
      }));

      // ALWAYS fetch versions for search results
      console.log("Fetching versions for search results...");
      const resultsWithVersions = await Promise.all(
        searchResultsWithLockInfo.map(async (file) => {
          try {
            console.log(`Fetching versions for file: ${file.fileName}`);
            const versions = await fetchFileVersions(file.fileName);
            console.log(
              `Fetched ${versions.length} versions for ${file.fileName}:`,
              versions
            );
            file.versions = versions;
            return file;
          } catch (error) {
            console.error(
              `Error fetching versions for ${file.fileName}:`,
              error
            );
            file.versions = [];
            return file;
          }
        })
      );

      setSearchResults(resultsWithVersions);
      setIsSearchMode(true);
      setCurrentPage(1);

      // If showVersionsInSearch is true, expand versions for all search results
      if (showVersionsInSearch) {
        const newExpandedVersions = new Set();
        resultsWithVersions.forEach((file) => {
          if (!file.isFolder) {
            newExpandedVersions.add(file.fullPath || file.fileName);
          }
        });
        setExpandedVersions(newExpandedVersions);
      }
    } catch (error) {
      console.error("Search error:", error);
      toast.error(`Search failed: ${error.message}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    performSearch(searchQuery);
  };

  const handleClearSearch = () => {
    setSearchQuery("");
    setIsSearchMode(false);
    setSearchResults([]);
    setCurrentPage(1);
    // Clear expanded versions when clearing search
    setExpandedVersions(new Set());
  };

  // Updated handleVersionToggleSearch function
  const handleVersionToggleSearch = async (newShowVersions) => {
    setShowVersionsInSearch(newShowVersions);

    if (newShowVersions) {
      // Show versions - expand all search results
      const newExpandedVersions = new Set();
      searchResults.forEach((file) => {
        if (!file.isFolder) {
          newExpandedVersions.add(file.fullPath || file.fileName);
        }
      });
      setExpandedVersions(newExpandedVersions);

      console.log(
        "Show versions toggled ON, expanded versions:",
        newExpandedVersions
      );
    } else {
      // Hide versions - collapse all
      setExpandedVersions(new Set());
      console.log("Show versions toggled OFF, collapsed all versions");
    }
  };

  const fetchFileVersions = async (filename) => {
    try {
      const response = await fetch(`${API_BASE_URL}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename }),
      });
      if (!response.ok) throw new Error("Failed to fetch versions");
      const data = await response.json();
      return data.versions || [];
    } catch (err) {
      console.error("Error fetching versions:", err);
      return [];
    }
  };

  // ✅ Upload via pre-signed URL for large files
  const uploadViaPresignedUrl = async (file, comment = null) => {
    console.log(`🚀 Large file upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    
    try {
      // Step 1: Request pre-signed URL from Lambda
      const getUrlPayload = {
        filename: file.webkitRelativePath || file.name,
        action: "put",
        content_type: file.type || "application/octet-stream"
      };

      if (comment && comment.trim()) {
        getUrlPayload.comment = comment.trim();
      }

      const getUrlResponse = await fetch(`${API_BASE_URL}/get-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getUrlPayload),
      });

      if (!getUrlResponse.ok) {
        throw new Error(`Failed to get pre-signed URL: ${getUrlResponse.status}`);
      }

      const { url, headers } = await getUrlResponse.json();

      // Step 2: Upload directly to S3 using pre-signed URL
      const uploadResponse = await fetch(url, {
        method: "PUT",
        headers: headers || {},
        body: file
      });

      if (!uploadResponse.ok) {
        throw new Error(`S3 upload failed: ${uploadResponse.status}`);
      }

      console.log(`✅ Large file uploaded successfully: ${file.name}`);
      return { success: true, filename: file.name };

    } catch (error) {
      console.error(`❌ Large file upload failed for ${file.name}:`, error);
      throw error;
    }
  };

  // ✅ Upload via API Gateway for small files (≤ 10 MB)
  const uploadViaApiGateway = async (file, comment = null) => {
    console.log(`📦 Small file upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Content = reader.result.split(",")[1];
          const fileKey = file.webkitRelativePath || file.name;
          const filePayload = {
            key: fileKey,
            content_base64: base64Content,
            content_type: file.type || "application/octet-stream",
          };

          if (comment && comment.trim()) {
            filePayload.comment = comment.trim();
          }

          resolve(filePayload);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  // ✅ Upload via pre-signed URL for large files (directory version)
  const uploadViaPresignedUrlDirectory = async (file, targetDir, comment = null) => {
    console.log(`🚀 Large directory file upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    
    try {
      const fileKey = `${targetDir}/${file.name}`;
      
      // Step 1: Request pre-signed URL from Lambda
      const getUrlPayload = {
        filename: fileKey,
        action: "put",
        content_type: file.type || "application/octet-stream"
      };

      if (comment && comment.trim()) {
        getUrlPayload.comment = comment.trim();
      }

      const getUrlResponse = await fetch(`${API_BASE_URL}/get-url`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(getUrlPayload),
      });

      if (!getUrlResponse.ok) {
        throw new Error(`Failed to get pre-signed URL: ${getUrlResponse.status}`);
      }

      const { url, headers } = await getUrlResponse.json();

      // Step 2: Upload directly to S3 using pre-signed URL
      const uploadResponse = await fetch(url, {
        method: "PUT",
        headers: headers || {},
        body: file
      });

      if (!uploadResponse.ok) {
        throw new Error(`S3 upload failed: ${uploadResponse.status}`);
      }

      console.log(`✅ Large directory file uploaded successfully: ${fileKey}`);
      return { success: true, filename: fileKey };

    } catch (error) {
      console.error(`❌ Large directory file upload failed for ${file.name}:`, error);
      throw error;
    }
  };

  // ✅ Upload via API Gateway for small files (directory version)
  const uploadViaApiGatewayDirectory = async (file, targetDir, comment = null) => {
    console.log(`📦 Small directory file upload: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const base64Content = reader.result.split(",")[1];
          const fileKey = `${targetDir}/${file.name}`;
          const filePayload = {
            key: fileKey,
            content_base64: base64Content,
            content_type: file.type || "application/octet-stream",
          };

          if (comment && comment.trim()) {
            filePayload.comment = comment.trim();
          }

          resolve(filePayload);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const createBlobFromResponse = async (response) => {
    try {
      const responseData = await response.json();

      if (responseData.content_base64) {
        const binaryString = atob(responseData.content_base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }

        return new Blob([bytes], {
          type: responseData.content_type || "application/octet-stream",
        });
      } else if (responseData.content) {
        return new Blob([responseData.content], {
          type: responseData.content_type || "text/plain",
        });
      } else {
        throw new Error("No content found in response");
      }
    } catch (error) {
      console.error("Error creating blob from response:", error);
      const text = await response.text();
      return new Blob([text], { type: "text/plain" });
    }
  };

  const organizeFiles = (fileList) => {
    const organized = [];
    const folderMap = {};

    const organizeNested = (items, currentMap, parentPath = "") => {
      items.forEach((file) => {
        const { fileName, locked, lockedBy, timestamp } = file;

        if (fileName.includes("/")) {
          const parts = fileName.split("/");
          const folderName = parts[0];
          const subPath = parts.slice(1).join("/");
          const fullFolderPath = parentPath
            ? `${parentPath}/${folderName}`
            : folderName;

          if (!currentMap[folderName]) {
            currentMap[folderName] = {
              fileName: folderName,
              fullPath: fullFolderPath,
              isFolder: true,
              locked: false,
              lockedBy: null,
              timestamp: null,
              children: [],
              childrenMap: {},
            };
          }

          if (subPath.includes("/")) {
            organizeNested(
              [
                {
                  fileName: subPath,
                  locked,
                  lockedBy,
                  timestamp,
                },
              ],
              currentMap[folderName].childrenMap,
              fullFolderPath
            );
          } else {
            currentMap[folderName].children.push({
              fileName: subPath,
              fullPath: parentPath
                ? `${parentPath}/${folderName}/${subPath}`
                : `${folderName}/${subPath}`,
              locked,
              lockedBy,
              timestamp,
              isFolder: false,
            });
          }
        } else {
          organized.push({
            fileName,
            locked,
            lockedBy,
            timestamp,
            isFolder: false,
          });
        }
      });
    };

    organizeNested(fileList, folderMap);

    const processNestedFolders = (folderObj) => {
      if (
        folderObj.childrenMap &&
        Object.keys(folderObj.childrenMap).length > 0
      ) {
        Object.values(folderObj.childrenMap).forEach((nestedFolder) => {
          processNestedFolders(nestedFolder);
          folderObj.children.push(nestedFolder);
        });
      }
      delete folderObj.childrenMap;
    };

    Object.values(folderMap).forEach((folder) => {
      processNestedFolders(folder);
      organized.push(folder);
    });

    return organized;
  };

  const flattenForDisplay = (organizedFiles, level = 0) => {
    const flattened = [];

    organizedFiles.forEach((item) => {
      flattened.push({
        ...item,
        nestingLevel: level,
      });

      const folderKey = item.fullPath || item.fileName;
      if (item.isFolder && expandedFolders.has(folderKey)) {
        item.children.forEach((child) => {
          if (child.isFolder) {
            const nestedItems = flattenForDisplay([child], level + 1);
            nestedItems.forEach((nestedItem) => {
              flattened.push({
                ...nestedItem,
                isChild: true,
                parentFolder: item.fileName,
                nestingLevel: level + 1,
              });
            });
          } else {
            flattened.push({
              ...child,
              isChild: true,
              parentFolder: item.fileName,
              nestingLevel: level + 1,
            });
          }
        });
      }
    });

    return flattened;
  };

  const handleVersionToggle = async (fileName) => {
    const newExpandedVersions = new Set(expandedVersions);
    if (newExpandedVersions.has(fileName)) {
      newExpandedVersions.delete(fileName);
      console.log(`Collapsed versions for: ${fileName}`);
    } else {
      newExpandedVersions.add(fileName);
      console.log(`Expanded versions for: ${fileName}`);

      // If this is a search result and we don't have versions yet, fetch them
      if (isSearchMode) {
        const file = searchResults.find(
          (f) => (f.fullPath || f.fileName) === fileName
        );
        if (file && (!file.versions || file.versions.length === 0)) {
          console.log(`Fetching versions for search result: ${fileName}`);
          try {
            const versions = await fetchFileVersions(fileName);
            console.log(
              `Fetched ${versions.length} versions for ${fileName}:`,
              versions
            );

            // Update the search results with the fetched versions
            const updatedSearchResults = searchResults.map((f) => {
              if ((f.fullPath || f.fileName) === fileName) {
                return { ...f, versions };
              }
              return f;
            });
            setSearchResults(updatedSearchResults);
          } catch (error) {
            console.error(`Error fetching versions for ${fileName}:`, error);
          }
        }
      }
    }
    setExpandedVersions(newExpandedVersions);
  };

  const handleVersionDownload = (fileName, version) => {
    setSelectedVersion({
      fileName,
      version,
      displayName: fileName.includes("/")
        ? fileName.split("/").pop()
        : fileName,
    });
    setVersionDownloadModalVisible(true);
  };

  const confirmVersionDownload = async () => {
    if (!selectedVersion) return;

    const { fileName, version, displayName } = selectedVersion;
    const downloadKey = `${fileName}-${version.VersionId}`;

    setDownloadingVersion(true);
    setDownloadingFiles((prev) => new Set(prev).add(downloadKey));

    try {
      const requestBody = {
        filename: fileName,
        versionId: version.VersionId,
      };

      console.log("Downloading version with payload:", requestBody);

      const response = await fetch(`${API_BASE_URL}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        throw new Error(
          `Download failed: ${response.status} ${response.statusText}`
        );
      }

      const responseData = await response.json();
      console.log("Backend response:", responseData);

      if (responseData.version_id) {
        console.log(`Downloaded version ID: ${responseData.version_id}`);
        console.log(`Requested version ID: ${version.VersionId}`);

        if (responseData.version_id !== version.VersionId) {
          console.warn(
            "Version ID mismatch! Requested:",
            version.VersionId,
            "Got:",
            responseData.version_id
          );
        }
      }

      const binaryString = atob(responseData.content_base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const blob = new Blob([bytes], {
        type: responseData.content_type || "application/octet-stream",
      });

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const fileExtension = displayName.includes(".")
        ? displayName.split(".").pop()
        : "";
      const fileNameWithoutExt = displayName.includes(".")
        ? displayName.substring(0, displayName.lastIndexOf("."))
        : displayName;

      let versionLabel;
      if (version.IsLatest) {
        versionLabel = "latest";
      } else if (version.VersionId === "null") {
        versionLabel = "original";
      } else {
        versionLabel = version.VersionId.substring(0, 8);
      }

      const downloadFileName = fileExtension
        ? `${fileNameWithoutExt}_v${versionLabel}.${fileExtension}`
        : `${fileNameWithoutExt}_v${versionLabel}`;

      link.download = downloadFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      const successMessage = responseData.version_id
        ? `Version ${responseData.version_id.substring(
            0,
            8
          )}... downloaded as "${downloadFileName}"!`
        : `File downloaded as "${downloadFileName}"!`;

      toast.success(successMessage);

      setVersionDownloadModalVisible(false);
      setSelectedVersion(null);
    } catch (error) {
      console.error("Version download error:", error);
      toast.error(`Failed to download version: ${error.message}`);
    } finally {
      setDownloadingVersion(false);
      setDownloadingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(downloadKey);
        return newSet;
      });
    }
  };

  const handleDownload = async (file) => {
    const fileName = file.fullPath || file.fileName;

    if (file.isFolder) {
      toast.error(
        "Cannot download folders directly. Please download individual files."
      );
      return;
    }

    setDownloadingFiles((prev) => new Set(prev).add(fileName));

    try {
      const response = await fetch(`${API_BASE_URL}/download`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: fileName }),
      });

      if (!response.ok) {
        throw new Error(
          `Download failed: ${response.status} ${response.statusText}`
        );
      }

      const blob = await createBlobFromResponse(response);

      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      const downloadFileName = fileName.includes("/")
        ? fileName.split("/").pop()
        : fileName;

      link.download = downloadFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`File "${downloadFileName}" downloaded successfully!`);
    } catch (error) {
      console.error("Download error:", error);
      toast.error(`Failed to download file: ${error.message}`);
    } finally {
      setDownloadingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(fileName);
        return newSet;
      });
    }
  };

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const [s3ResRaw, lockRes] = await Promise.all([
        fetch(`${API_BASE_URL}/s3-files`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/list`).then((r) => r.json()),
      ]);

      const s3Res = Array.isArray(s3ResRaw) ? s3ResRaw : s3ResRaw.items || [];

      const lockMap = {};
      lockRes.forEach((item) => {
        lockMap[item.filename] = {
          locked: item.status === "locked",
          lockedBy: item.locked_by || null,
          timestamp: item.timestamp || null,
        };
      });

      const merged = s3Res.map((fileObj) => {
        const fileName = fileObj.key;
        return {
          fileName,
          locked: lockMap[fileName]?.locked || false,
          lockedBy: lockMap[fileName]?.lockedBy || null,
          timestamp: lockMap[fileName]?.timestamp || null,
          size: fileObj.size,
          lastModified: fileObj.last_modified,
          eTag: fileObj.e_tag,
        };
      });

      const organized = organizeFiles(merged);

      const fetchVersionsRecursively = async (items) => {
        return Promise.all(
          items.map(async (item) => {
            if (item.isFolder) {
              if (item.children && item.children.length > 0) {
                item.children = await fetchVersionsRecursively(item.children);
              }
              return item;
            } else {
              const filePathForVersions = item.fullPath || item.fileName;
              item.versions = await fetchFileVersions(filePathForVersions);
              return item;
            }
          })
        );
      };

      const withVersions = await fetchVersionsRecursively(organized);

      setFiles(withVersions);
    } catch (err) {
      console.error("Error fetching files:", err);
      toast.error("Failed to fetch files");
      throw err;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const userInfo = getUserFromToken();
    if (userInfo) setUser(userInfo);
    fetchFiles();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFolderToggle = (folderPath) => {
    const newExpandedFolders = new Set(expandedFolders);
    if (newExpandedFolders.has(folderPath)) {
      newExpandedFolders.delete(folderPath);
    } else {
      newExpandedFolders.add(folderPath);
    }
    setExpandedFolders(newExpandedFolders);
  };

  const handleLockToggle = async (indexOnPage) => {
    const displayFiles = isSearchMode
      ? searchResults
      : flattenForDisplay(files);
    const index = (currentPage - 1) * pageSize + indexOnPage;
    const file = displayFiles[index];

    if (file.isFolder) {
      toast.error("Cannot lock/unlock folders directly");
      return;
    }

    if (!user) {
      toast.error("User not authenticated");
      return;
    }

    try {
      const fileName = file.fullPath || file.fileName;
      const endpoint = file.locked ? "unlock" : "lock";
      const isCurrentlyLocked = file.locked;

      const payload = file.locked
        ? { filename: fileName }
        : { filename: fileName, user: user.email };

      const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        // Update files in both search results and main files list
        if (isSearchMode) {
          const updatedSearchResults = [...searchResults];
          const fileToUpdate = updatedSearchResults[index];
          if (fileToUpdate) {
            fileToUpdate.locked = !fileToUpdate.locked;
            fileToUpdate.lockedBy = fileToUpdate.locked ? user.email : null;
            fileToUpdate.timestamp = fileToUpdate.locked
              ? new Date().toISOString()
              : null;
          }
          setSearchResults(updatedSearchResults);
        } else {
          const updatedFiles = [...files];
          if (file.isChild) {
            const parentFolder = updatedFiles.find(
              (f) => f.fileName === file.parentFolder
            );
            if (parentFolder) {
              const childFile = parentFolder.children.find(
                (c) => c.fullPath === fileName
              );
              if (childFile) {
                childFile.locked = !childFile.locked;
                childFile.lockedBy = childFile.locked ? user.email : null;
                childFile.timestamp = childFile.locked
                  ? new Date().toISOString()
                  : null;
              }
            }
          } else {
            const fileToUpdate = updatedFiles.find(
              (f) => f.fileName === fileName
            );
            if (fileToUpdate) {
              fileToUpdate.locked = !fileToUpdate.locked;
              fileToUpdate.lockedBy = fileToUpdate.locked ? user.email : null;
              fileToUpdate.timestamp = fileToUpdate.locked
                ? new Date().toISOString()
                : null;
            }
          }
          setFiles(updatedFiles);
        }

        toast.success(
          `File ${isCurrentlyLocked ? "unlocked" : "locked"} successfully`
        );
      } else {
        console.error(`${endpoint} failed`);
        toast.error(`Failed to ${endpoint} file`);
      }
    } catch (error) {
      console.error("Lock toggle error:", error);
      toast.error(`Error ${file.locked ? "unlocking" : "locking"} file`);
    }
  };

  const handleUploadSelection = (e) => {
    const type = e.target.value;
    setUploadType(type);

    if (type === "file") {
      fileInputRef.current?.click();
    } else if (type === "folder") {
      folderInputRef.current?.click();
    }
  };

  const handleFileChange = (e) => {
    const files = Array.from(e.target.files);
    setSelectedFiles(files);

    // Initialize comments for each file
    const initialComments = {};
    files.forEach((file) => {
      const fileKey = file.webkitRelativePath || file.name;
      initialComments[fileKey] = fileComments[fileKey] || ""; // Preserve existing comments
    });
    setFileComments(initialComments);

    if (uploadType === "file" && fileInputRef.current)
      fileInputRef.current.value = "";
    if (uploadType === "folder" && folderInputRef.current)
      folderInputRef.current.value = "";
  };

  const resetUploadState = () => {
    setSelectedFiles([]);
    setUploadType(null);
    setFileComments({});
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  const handleDirectoryUpload = (folderName, folderFullPath) => {
    setTargetDirectory(folderFullPath || folderName);
    setDirectoryUploadModalVisible(true);
  };

  const handleDirectoryFileChange = (e) => {
    const files = Array.from(e.target.files);
    setDirectorySelectedFiles(files);

    // Initialize comments for directory files
    const initialComments = {};
    files.forEach((file) => {
      const fileKey = `${targetDirectory}/${file.name}`;
      initialComments[fileKey] = "";
    });
    setFileComments(initialComments);
  };

  const resetDirectoryUploadState = () => {
    setDirectorySelectedFiles([]);
    setTargetDirectory("");
    setFileComments({});
    if (directoryFileInputRef.current) directoryFileInputRef.current.value = "";
  };

  const handleDirectoryFileUpload = async () => {
    if (!directorySelectedFiles.length) {
      toast.error("Please select files to upload");
      return;
    }

    setDirectoryUploading(true);
    const loadingToast = toast.loading(
      `Uploading files to ${targetDirectory}...`
    );

    try {
      console.log("Starting hybrid directory upload process...");

      // ✅ Separate files by size
      const smallFiles = [];
      const largeFiles = [];

      directorySelectedFiles.forEach(file => {
        const fileSizeMB = file.size / (1024 * 1024);
        console.log(`📁 ${targetDirectory}/${file.name}: ${fileSizeMB.toFixed(2)} MB`);
        
        if (file.size <= 10 * 1024 * 1024) { // ≤ 10 MB
          smallFiles.push(file);
        } else {
          largeFiles.push(file);
        }
      });

      console.log(`📦 Small directory files (≤10MB): ${smallFiles.length}`);
      console.log(`🚀 Large directory files (>10MB): ${largeFiles.length}`);

      const uploadResults = [];
      let successCount = 0;
      let errorCount = 0;

      // ✅ Upload small files via API Gateway (if any)
      if (smallFiles.length > 0) {
        try {
          console.log("📦 Processing small directory files via API Gateway...");
          
          const smallFilesPayload = await Promise.all(
            smallFiles.map(async (file) => {
              const fileKey = `${targetDirectory}/${file.name}`;
              const comment = fileComments[fileKey];
              return await uploadViaApiGatewayDirectory(file, targetDirectory, comment);
            })
          );

          const response = await fetch(`${API_BASE_URL}/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: smallFilesPayload }),
          });

          const result = await response.json();

          if (response.ok && result.uploaded) {
            successCount += result.uploaded.length;
            uploadResults.push(`✅ ${result.uploaded.length} small file(s) via API Gateway`);
          } else {
            errorCount += smallFiles.length;
            uploadResults.push(`❌ ${smallFiles.length} small file(s) failed`);
          }
        } catch (error) {
          console.error("Small directory files upload error:", error);
          errorCount += smallFiles.length;
          uploadResults.push(`❌ ${smallFiles.length} small file(s) failed`);
        }
      }

      // ✅ Upload large files via pre-signed URLs (if any)
      if (largeFiles.length > 0) {
        console.log("🚀 Processing large directory files via S3 pre-signed URLs...");
        
        const largeFilePromises = largeFiles.map(async (file) => {
          try {
            const fileKey = `${targetDirectory}/${file.name}`;
            const comment = fileComments[fileKey];
            await uploadViaPresignedUrlDirectory(file, targetDirectory, comment);
            return { success: true, filename: `${targetDirectory}/${file.name}` };
          } catch (error) {
            console.error(`Failed to upload large directory file ${file.name}:`, error);
            return { success: false, filename: `${targetDirectory}/${file.name}`, error };
          }
        });

        const largeFileResults = await Promise.all(largeFilePromises);
        
        const successfulLargeFiles = largeFileResults.filter(r => r.success);
        const failedLargeFiles = largeFileResults.filter(r => !r.success);

        successCount += successfulLargeFiles.length;
        errorCount += failedLargeFiles.length;

        if (successfulLargeFiles.length > 0) {
          uploadResults.push(`✅ ${successfulLargeFiles.length} large file(s) via S3 direct upload`);
        }
        if (failedLargeFiles.length > 0) {
          uploadResults.push(`❌ ${failedLargeFiles.length} large file(s) failed`);
        }
      }

      toast.dismiss(loadingToast);

      // ✅ Show results
      if (successCount > 0) {
        console.log("Directory upload successful, showing success message...");
        
        const successMessage = successCount === directorySelectedFiles.length 
          ? `🎉 Successfully uploaded all ${successCount} file(s) to ${targetDirectory}!`
          : `🎉 Successfully uploaded ${successCount} out of ${directorySelectedFiles.length} file(s) to ${targetDirectory}!`;

        toast.success(successMessage, {
          duration: 6000,
          position: "top-center",
          style: {
            background: "#10B981",
            color: "white",
            fontWeight: "600",
            padding: "16px",
            borderRadius: "12px",
            fontSize: "14px",
            maxWidth: "500px",
          },
          iconTheme: {
            primary: "white",
            secondary: "#10B981",
          },
        });

        setDirectoryUploadModalVisible(false);
        resetDirectoryUploadState();

        console.log("Refreshing file list after directory upload...");
        try {
          await fetchFiles();
          console.log(
            "File list refreshed successfully after directory upload"
          );
        } catch (fetchError) {
          console.error("Error refreshing file list:", fetchError);
          toast.error(
            "Files uploaded but failed to refresh the list. Please refresh the page."
          );
        }
      } else {
        console.warn("All directory uploads failed");
        toast.error("All directory file uploads failed. Please try again.");
      }

      if (errorCount > 0 && successCount === 0) {
        toast.error(`Failed to upload ${errorCount} file(s) to ${targetDirectory}. Please check file sizes and try again.`);
      }

    } catch (err) {
      console.error("Directory upload error:", err);
      toast.dismiss(loadingToast);
      toast.error("Upload failed. Please try again.");
    } finally {
      setDirectoryUploading(false);
      console.log("Hybrid directory upload process completed");
    }
  };

  const handleUpload = async () => {
    if (!selectedFiles.length) {
      toast.error("Please select files or a folder to upload");
      return;
    }

    setUploading(true);
    const loadingToast = toast.loading("Uploading files...");

    try {
      console.log("Starting hybrid upload process...");

      // ✅ Separate files by size
      const smallFiles = [];
      const largeFiles = [];

      selectedFiles.forEach(file => {
        const fileSizeMB = file.size / (1024 * 1024);
        console.log(`📁 ${file.name}: ${fileSizeMB.toFixed(2)} MB`);
        
        if (file.size <= 10 * 1024 * 1024) { // ≤ 10 MB
          smallFiles.push(file);
        } else {
          largeFiles.push(file);
        }
      });

      console.log(`📦 Small files (≤10MB): ${smallFiles.length}`);
      console.log(`🚀 Large files (>10MB): ${largeFiles.length}`);

      const uploadResults = [];
      let successCount = 0;
      let errorCount = 0;

      // ✅ Upload small files via API Gateway (if any)
      if (smallFiles.length > 0) {
        try {
          console.log("📦 Processing small files via API Gateway...");
          
          const smallFilesPayload = await Promise.all(
            smallFiles.map(async (file) => {
              const fileKey = file.webkitRelativePath || file.name;
              const comment = fileComments[fileKey];
              return await uploadViaApiGateway(file, comment);
            })
          );

          console.log("📦 Payload prepared for API Gateway:", smallFilesPayload);

          const response = await fetch(`${API_BASE_URL}/upload`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ files: smallFilesPayload }),
          });

          console.log("📦 API Gateway Response Status:", response.status);
          console.log("📦 API Gateway Response OK:", response.ok);

          const result = await response.json();
          console.log("📦 API Gateway Response Data:", result);

          // Handle both "uploaded" and "uploads" response formats
          const uploadedFiles = result.uploaded || result.uploads;

          if (response.ok && uploadedFiles && uploadedFiles.length > 0) {
            console.log("✅ Small files upload successful:", uploadedFiles);
            successCount += uploadedFiles.length;
            uploadResults.push(`✅ ${uploadedFiles.length} small file(s) via API Gateway`);
          } else {
            console.error("❌ Small files upload failed. Status:", response.status, "Result:", result);
            errorCount += smallFiles.length;
            uploadResults.push(`❌ ${smallFiles.length} small file(s) failed: ${result.error || result.message || 'Unknown error'}`);
          }
        } catch (error) {
          console.error("Small files upload error:", error);
          console.error("Error details:", {
            message: error.message,
            stack: error.stack,
            API_BASE_URL
          });
          errorCount += smallFiles.length;
          uploadResults.push(`❌ ${smallFiles.length} small file(s) failed: ${error.message}`);
        }
      }

      // ✅ Upload large files via pre-signed URLs (if any)
      if (largeFiles.length > 0) {
        console.log("🚀 Processing large files via S3 pre-signed URLs...");
        
        const largeFilePromises = largeFiles.map(async (file) => {
          try {
            const fileKey = file.webkitRelativePath || file.name;
            const comment = fileComments[fileKey];
            await uploadViaPresignedUrl(file, comment);
            return { success: true, filename: file.name };
          } catch (error) {
            console.error(`Failed to upload large file ${file.name}:`, error);
            return { success: false, filename: file.name, error };
          }
        });

        const largeFileResults = await Promise.all(largeFilePromises);
        
        const successfulLargeFiles = largeFileResults.filter(r => r.success);
        const failedLargeFiles = largeFileResults.filter(r => !r.success);

        successCount += successfulLargeFiles.length;
        errorCount += failedLargeFiles.length;

        if (successfulLargeFiles.length > 0) {
          uploadResults.push(`✅ ${successfulLargeFiles.length} large file(s) via S3 direct upload`);
        }
        if (failedLargeFiles.length > 0) {
          uploadResults.push(`❌ ${failedLargeFiles.length} large file(s) failed`);
        }
      }

      toast.dismiss(loadingToast);

      // ✅ Show results
      if (successCount > 0) {
        console.log("Upload successful, showing success message...");
        
        const successMessage = successCount === selectedFiles.length 
          ? `🎉 Successfully uploaded all ${successCount} file(s)!`
          : `🎉 Successfully uploaded ${successCount} out of ${selectedFiles.length} file(s)!`;

        toast.success(successMessage, {
          duration: 6000,
          position: "top-center",
          style: {
            background: "#10B981",
            color: "white",
            fontWeight: "600",
            padding: "16px",
            borderRadius: "12px",
            fontSize: "14px",
            maxWidth: "500px",
          },
          iconTheme: {
            primary: "white",
            secondary: "#10B981",
          },
        });

        setUploadModalVisible(false);
        resetUploadState();

        console.log("Refreshing file list...");
        try {
          await fetchFiles();
          console.log("File list refreshed successfully");
        } catch (fetchError) {
          console.error("Error refreshing file list:", fetchError);
          toast.error(
            "Files uploaded but failed to refresh the list. Please refresh the page."
          );
        }
      } else {
        console.warn("All uploads failed");
        toast.error("All file uploads failed. Please try again.");
      }

      if (errorCount > 0 && successCount === 0) {
        toast.error(`Failed to upload ${errorCount} file(s). Please check file sizes and try again.`);
      }

    } catch (err) {
      console.error("Upload error:", err);
      toast.dismiss(loadingToast);
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      console.log("Hybrid upload process completed");
    }
  };

  // Get the files to display (either search results or normal files)
  const displayFiles = isSearchMode ? searchResults : flattenForDisplay(files);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedFiles = displayFiles.slice(startIndex, startIndex + pageSize);

  const formatDateTime = (timestamp) => {
    if (!timestamp) return "-";

    const date = new Date(timestamp);
    const dateStr = date.toLocaleDateString("en-US", {
      year: "2-digit",
      month: "2-digit",
      day: "2-digit",
    });
    const timeStr = date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });

    return `${dateStr}, ${timeStr}`;
  };

  const CommentCell = ({ fileName }) => {
    const [comment, setComment] = useState("");
    const [loading, setLoading] = useState(false);

    useEffect(() => {
      const loadComment = async () => {
        setLoading(true);
        const fetchedComment = await fetchFileComments(fileName);
        setComment(fetchedComment);
        setLoading(false);
      };
      loadComment();
    }, [fileName]);

    if (loading) {
      return (
        <span style={{ color: "#999", fontSize: "12px" }}>Loading...</span>
      );
    }

    if (!comment) {
      return (
        <span style={{ color: "#ccc", fontSize: "12px" }}>No comment</span>
      );
    }

    return (
      <Tooltip title={comment} placement="topLeft">
        <div
          style={{
            maxWidth: "150px",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "15px",
            // color: "#666",
          }}
        >
          {comment}
        </div>
      </Tooltip>
    );
  };

  // Add function to handle comment changes
  const handleCommentChange = (fileKey, comment) => {
    setFileComments((prev) => ({
      ...prev,
      [fileKey]: comment,
    }));
  };

  // Add function to fetch and display comments in file list
  const fetchFileComments = async (fileName) => {
    try {
      const response = await fetch(`${API_BASE_URL}/tags`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: fileName }),
      });

      if (response.ok) {
        const data = await response.json();
        return data.tags?.comment || "";
      }
    } catch (error) {
      console.error("Error fetching comments:", error);
    }
    return "";
  };

  return (
    <div className="file-container">
      <Toaster
        position="top-center"
        reverseOrder={false}
        gutter={8}
        containerClassName=""
        containerStyle={{}}
        toastOptions={{
          className: "",
          duration: 4000,
          style: {
            background: "#1F2937",
            color: "#F9FAFB",
            fontSize: "14px",
            fontWeight: "500",
            borderRadius: "12px",
            padding: "16px",
            boxShadow:
              "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
          },
          success: {
            duration: 4000,
            iconTheme: {
              primary: "#10B981",
              secondary: "white",
            },
          },
          error: {
            duration: 4000,
            iconTheme: {
              primary: "#EF4444",
              secondary: "white",
            },
          },
        }}
      />

      {/* Enhanced Header with Larger Logo */}
      <div className="header-container">
        <div className="header-content">
          <div className="title-section">
            <h1 className="main-title">File Manager</h1>
            <p className="subtitle">Files in S3 Bucket</p>
          </div>
          <div className="logo-section">
            <img
              src="/DCLI_Logo.jpg"
              alt="DCLI Logo"
              className="company-logo"
            />
          </div>
        </div>
      </div>

      {/* Enhanced Search and Upload Section */}
      <div className="controls-section">
        {/* Search Section */}
        <div className="search-section">
          <form onSubmit={handleSearchSubmit} className="search-form">
            <div className="search-input-container">
              <Input
                placeholder="Search files by name..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                prefix={<SearchOutlined />}
                size="large"
                className="search-input"
                disabled={isSearching}
              />
              <Button
                type="primary"
                htmlType="submit"
                size="large"
                loading={isSearching}
                disabled={!searchQuery.trim()}
                className="search-button"
              >
                {isSearching ? "Searching..." : "Search"}
              </Button>
              {(isSearchMode || searchQuery) && (
                <Button
                  size="large"
                  onClick={handleClearSearch}
                  className="clear-search-button"
                  icon={<ClearOutlined />}
                >
                  Clear
                </Button>
              )}
            </div>
          </form>

          {/* Show Versions Toggle for Search */}
          {isSearchMode && (
            <div className="search-options">
              <div className="version-toggle-container">
                <span className="toggle-label">Show Versions:</span>
                <Switch
                  checked={showVersionsInSearch}
                  onChange={handleVersionToggleSearch}
                  loading={isSearching}
                  size="default"
                />
              </div>
              <div className="search-info">
                Found {searchResults.length} file(s) matching "{searchQuery}"
              </div>
            </div>
          )}
        </div>

        {/* Upload Section */}
        <div className="upload-section">
          <Button
            type="primary"
            size="large"
            onClick={() => setUploadModalVisible(true)}
            loading={uploading}
            disabled={uploading}
            className="upload-button"
          >
            {uploading ? "Processing..." : "Click here to choose files"}
          </Button>
        </div>
      </div>

      {/* Enhanced Upload Modal */}
      <Modal
        open={uploadModalVisible}
        title={
          <div className="modal-title">
            <span className="modal-icon">📤</span>
            Upload Options
          </div>
        }
        onCancel={() => {
          if (!uploading) {
            setUploadModalVisible(false);
            resetUploadState();
          }
        }}
        closable={!uploading}
        maskClosable={!uploading}
        className="custom-modal"
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setUploadModalVisible(false);
              resetUploadState();
            }}
            disabled={uploading}
            className="cancel-button"
          >
            Cancel
          </Button>,
          <Button
            key="upload"
            type="primary"
            onClick={handleUpload}
            disabled={selectedFiles.length === 0}
            loading={uploading}
            className="upload-modal-button"
          >
            {uploading ? "Uploading..." : "Upload"}
          </Button>,
        ]}
      >
        <div className="upload-options">
          <Radio.Group
            onChange={handleUploadSelection}
            value={uploadType}
            disabled={uploading}
            className="radio-group"
          >
            <div className="radio-option">
              <Radio value="file" className="custom-radio">
                <span className="radio-label">
                  <span className="radio-icon">📄</span>
                  File Upload
                </span>
              </Radio>
            </div>
            <div className="radio-option">
              <Radio value="folder" className="custom-radio">
                <span className="radio-label">
                  <span className="radio-icon">📁</span>
                  Folder Upload
                </span>
              </Radio>
            </div>
          </Radio.Group>
        </div>

        <input
          type="file"
          ref={fileInputRef}
          style={{ display: "none" }}
          multiple
          onChange={handleFileChange}
          disabled={uploading}
        />
        <input
          type="file"
          ref={folderInputRef}
          style={{ display: "none" }}
          multiple
          webkitdirectory="true"
          directory="true"
          onChange={handleFileChange}
          disabled={uploading}
        />

        {selectedFiles.length > 0 && (
          <div className="selected-files with-comments">
            <h4 className="selected-files-title">
              <span className="files-count">{selectedFiles.length}</span>{" "}
              file(s) selected:
            </h4>
            <div className="file-list-with-comments">
              {selectedFiles.map((file, index) => {
                const fileKey = file.webkitRelativePath || file.name;
                
                return (
                  <div key={index} className="file-item-with-comment">
                    <div className="file-info">
                      <span className="file-icon">📄</span>
                      <span className="file-name">{fileKey}</span>
                    </div>
                    <div className="comment-input-container">
                      <Input.TextArea
                        placeholder="Add a comment for this file (optional)"
                        value={fileComments[fileKey] || ""}
                        onChange={(e) =>
                          handleCommentChange(fileKey, e.target.value)
                        }
                        disabled={uploading}
                        rows={2}
                        maxLength={250}
                        showCount
                        className="comment-input"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      {/* Enhanced Directory Upload Modal */}
      <Modal
        open={directoryUploadModalVisible}
        title={
          <div className="modal-title">
            <span className="modal-icon">📂</span>
            Upload to Directory:{" "}
            <span className="directory-name">{targetDirectory}</span>
          </div>
        }
        onCancel={() => {
          if (!directoryUploading) {
            setDirectoryUploadModalVisible(false);
            resetDirectoryUploadState();
          }
        }}
        closable={!directoryUploading}
        maskClosable={!directoryUploading}
        className="custom-modal"
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setDirectoryUploadModalVisible(false);
              resetDirectoryUploadState();
            }}
            disabled={directoryUploading}
            className="cancel-button"
          >
            Cancel
          </Button>,
          <Button
            key="select-files"
            onClick={() => directoryFileInputRef.current?.click()}
            disabled={directoryUploading}
            className="select-files-button"
          >
            Select Files
          </Button>,
          <Button
            key="upload"
            type="primary"
            onClick={handleDirectoryFileUpload}
            disabled={directorySelectedFiles.length === 0}
            loading={directoryUploading}
            className="upload-modal-button"
          >
            {directoryUploading ? "Uploading..." : "Upload"}
          </Button>,
        ]}
      >
        <div className="directory-upload-content">
          <div className="target-directory">
            <span className="label">Target Directory:</span>
            <span className="directory-path">{targetDirectory}</span>
          </div>
          <p className="instruction">
            Select files to upload to this directory
          </p>
        </div>

        <input
          type="file"
          ref={directoryFileInputRef}
          style={{ display: "none" }}
          multiple
          onChange={handleDirectoryFileChange}
          disabled={directoryUploading}
        />

        {directorySelectedFiles.length > 0 && (
          <div className="selected-files with-comments directory-files">
            <h4 className="selected-files-title">
              <span className="files-count">
                {directorySelectedFiles.length}
              </span>{" "}
              file(s) selected for {targetDirectory}:
            </h4>
            <div className="file-list-with-comments">
              {directorySelectedFiles.map((file, index) => {
                const fileKey = `${targetDirectory}/${file.name}`;
                
                return (
                  <div key={index} className="file-item-with-comment">
                    <div className="file-info">
                      <span className="file-icon">📄</span>
                      <span className="file-name">{fileKey}</span>
                    </div>
                    <div className="comment-input-container">
                      <Input.TextArea
                        placeholder="Add a comment for this file (optional)"
                        value={fileComments[fileKey] || ""}
                        onChange={(e) =>
                          handleCommentChange(fileKey, e.target.value)
                        }
                        disabled={directoryUploading}
                        rows={2}
                        maxLength={250}
                        showCount
                        className="comment-input"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Modal>

      {/* Version Download Confirmation Modal */}
      <Modal
        open={versionDownloadModalVisible}
        title={
          <div className="modal-title">
            <span className="modal-icon">📥</span>
            Download File Version
          </div>
        }
        onCancel={() => {
          if (!downloadingVersion) {
            setVersionDownloadModalVisible(false);
            setSelectedVersion(null);
          }
        }}
        closable={!downloadingVersion}
        maskClosable={!downloadingVersion}
        className="custom-modal version-download-modal"
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setVersionDownloadModalVisible(false);
              setSelectedVersion(null);
            }}
            disabled={downloadingVersion}
            className="cancel-button"
          >
            Cancel
          </Button>,
          <Button
            key="download"
            type="primary"
            onClick={confirmVersionDownload}
            loading={downloadingVersion}
            className="download-confirm-button"
          >
            {downloadingVersion ? "Downloading..." : "Download"}
          </Button>,
        ]}
      >
        {selectedVersion && (
          <div className="version-download-content">
            <div className="download-info">
              <div className="file-info">
                <h4 className="file-name-title">
                  <span className="file-icon">📄</span>
                  {selectedVersion.displayName}
                </h4>
                <div className="version-details">
                  <div className="detail-item">
                    <span className="detail-label">Version ID:</span>
                    <span className="detail-value">
                      {selectedVersion.version.VersionId === "null"
                        ? "Original Version"
                        : selectedVersion.version.VersionId}
                      {selectedVersion.version.IsLatest && (
                        <span className="latest-badge">LATEST</span>
                      )}
                    </span>
                  </div>
                </div>
              </div>
              <div className="confirmation-message">
                <p>
                  Are you sure you want to download this version of the file?
                </p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Loading State */}
      {loading ? (
        <div className="custom-loader">
          <div className="spinner"></div>
          <div className="loader-text">Please Wait...</div>
        </div>
      ) : (isSearchMode ? searchResults.length === 0 : files.length === 0) ? (
        <div className="no-files-message">
          {isSearchMode
            ? `No files found matching "${searchQuery}"`
            : "No files found"}
        </div>
      ) : (
        <>
          {/* Enhanced File Table with All Version Details */}
          <table className="file-table">
            <thead>
              <tr>
                <th>File Name</th>
                <th>Locked</th>
                <th>Locked By</th>
                <th>Locked Date</th>
                <th>Current Version</th>
                <th>Last Modified</th>
                <th>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    Comments
                    <Switch
                      size="small"
                      checked={showComments}
                      onChange={setShowComments}
                      title="Show/Hide Comments"
                    />
                  </div>
                </th>
                <th>Download</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedFiles.map((file, index) => {
                const fileName = file.fullPath || file.fileName;
                const isDownloading = downloadingFiles.has(fileName);
                const isVersionExpanded = expandedVersions.has(fileName);

                return (
                  <React.Fragment key={fileName}>
                    <tr
                      className={
                        file.isChild
                          ? "child-file"
                          : file.isSearchResult
                          ? "search-result"
                          : ""
                      }
                    >
                      <td
                        style={{
                          paddingLeft: file.isChild
                            ? `${(file.nestingLevel || 1) * 30}px`
                            : "10px",
                        }}
                      >
                        {file.isFolder ? (
                          <span
                            style={{ display: "flex", alignItems: "center" }}
                          >
                            <span style={{ marginRight: "8px" }}>📁</span>
                            <span>{file.fileName}</span>
                            <span
                              style={{
                                marginLeft: "8px",
                                fontSize: "12px",
                                color: "#666",
                              }}
                            >
                              ({file.children?.length || 0} items)
                            </span>
                            <span
                              onClick={() =>
                                handleFolderToggle(
                                  file.fullPath || file.fileName
                                )
                              }
                              style={{
                                marginLeft: "10px",
                                cursor: "pointer",
                                fontSize: "16px",
                                color: "#1890ff",
                                fontWeight: "bold",
                                padding: "2px 6px",
                                borderRadius: "3px",
                                transition: "background-color 0.2s ease",
                              }}
                              onMouseOver={(e) =>
                                (e.target.style.backgroundColor = "#f0f8ff")
                              }
                              onMouseOut={(e) =>
                                (e.target.style.backgroundColor = "transparent")
                              }
                            >
                              {expandedFolders.has(
                                file.fullPath || file.fileName
                              )
                                ? "▲"
                                : "▼"}
                            </span>
                          </span>
                        ) : (
                          <span
                            style={{ display: "flex", alignItems: "center" }}
                          >
                            {!file.isChild && (
                              <span style={{ marginRight: "8px" }}>📄</span>
                            )}
                            {file.isChild && (
                              <span style={{ marginRight: "8px" }}>📄</span>
                            )}
                            <span
                              style={{
                                backgroundColor: file.isSearchResult
                                  ? "#fff3cd"
                                  : "transparent",
                                padding: file.isSearchResult ? "2px 4px" : "0",
                                borderRadius: file.isSearchResult ? "3px" : "0",
                              }}
                            >
                              {file.fileName}
                            </span>
                          </span>
                        )}
                      </td>
                      <td>
                        {file.isFolder ? "-" : file.locked ? "Yes" : "No"}
                      </td>
                      <td>
                        {file.isFolder ? (
                          "-"
                        ) : file.locked ? (
                          <Tooltip title={file.lockedBy}>
                            {file.lockedBy}
                          </Tooltip>
                        ) : (
                          "-"
                        )}
                      </td>
                      <td>
                        {file.isFolder
                          ? "-"
                          : file.locked && file.timestamp
                          ? formatDateTime(file.timestamp)
                          : "-"}
                      </td>
                      <td>
                        {file.isFolder ? (
                          "-"
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <span
                              onClick={() => handleVersionToggle(fileName)}
                              style={{
                                color: "#1890ff",
                                cursor: "pointer",
                                textDecoration: "underline",
                                fontSize: "14px",
                                fontWeight: "500",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              {isSearchMode && showVersionsInSearch
                                ? isVersionExpanded
                                  ? "Hide versions"
                                  : "Show versions"
                                : "Click here to see version"}
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: "bold",
                                  transition: "transform 0.2s ease",
                                  transform: isVersionExpanded
                                    ? "rotate(180deg)"
                                    : "rotate(0deg)",
                                }}
                              >
                                ▼
                              </span>
                            </span>
                          </div>
                        )}
                      </td>

                      <td>
                        {file.isFolder
                          ? "-"
                          : (() => {
                              const latest = file.versions?.find(
                                (v) => v.IsLatest
                              );
                              return latest?.LastModified
                                ? formatDateTime(latest.LastModified)
                                : formatDateTime(file.lastModified) || "-";
                            })()}
                      </td>

                      <td>
                        {file.isFolder ? (
                          "-"
                        ) : showComments ? (
                          <CommentCell
                            fileName={file.fullPath || file.fileName}
                          />
                        ) : (
                          <Button
                            size="small"
                            type="link"
                            onClick={() => setShowComments(true)}
                            style={{ padding: 0, fontSize: "12px" }}
                          >
                            Show Comments
                          </Button>
                        )}
                      </td>

                      <td>
                        {file.isFolder ? (
                          "-"
                        ) : (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "4px",
                            }}
                          >
                            <Tooltip title={`Download ${file.fileName}`}>
                              <button
                                className="download-btn"
                                onClick={() => handleDownload(file)}
                                disabled={
                                  uploading ||
                                  directoryUploading ||
                                  isDownloading
                                }
                                style={{
                                  backgroundColor: "#1890ff",
                                  color: "white",
                                  border: "none",
                                  borderRadius: "4px",
                                  padding: "4px 8px",
                                  cursor: isDownloading
                                    ? "not-allowed"
                                    : "pointer",
                                  fontSize: "12px",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  opacity: isDownloading ? 0.6 : 1,
                                  transition: "all 0.2s ease",
                                }}
                                onMouseOver={(e) => {
                                  if (!isDownloading) {
                                    e.target.style.backgroundColor = "#40a9ff";
                                  }
                                }}
                                onMouseOut={(e) => {
                                  if (!isDownloading) {
                                    e.target.style.backgroundColor = "#1890ff";
                                  }
                                }}
                              >
                                {isDownloading ? (
                                  <>
                                    <span
                                      className="spinner"
                                      style={{
                                        width: "12px",
                                        height: "12px",
                                        border: "2px solid #fff",
                                        borderTop: "2px solid transparent",
                                        borderRadius: "50%",
                                        animation: "spin 1s linear infinite",
                                      }}
                                    ></span>
                                    Downloading...
                                  </>
                                ) : (
                                  <>⬇️ Download</>
                                )}
                              </button>
                            </Tooltip>
                          </div>
                        )}
                      </td>
                      <td>
                        {file.isFolder ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                            }}
                          >
                            <Tooltip
                              title={`Upload files to ${
                                file.fullPath || file.fileName
                              } directory`}
                            >
                              <button
                                className="upload-to-directory-btn"
                                onClick={() =>
                                  handleDirectoryUpload(
                                    file.fileName,
                                    file.fullPath
                                  )
                                }
                                disabled={uploading || directoryUploading}
                                style={{
                                  backgroundColor: "#4096ff",
                                  color: "white",
                                  border: "none",
                                  borderRadius: "4px",
                                  padding: "4px 8px",
                                  cursor: "pointer",
                                  fontSize: "12px",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                  transition: "background-color 0.2s ease",
                                }}
                                onMouseOver={(e) => {
                                  e.target.style.backgroundColor = "#389e0d";
                                }}
                                onMouseOut={(e) => {
                                  e.target.style.backgroundColor = "#4096ff";
                                }}
                              >
                                📤 Upload to Directory
                              </button>
                            </Tooltip>
                          </div>
                        ) : (
                          <button
                            className={file.locked ? "unlock-btn" : "lock-btn"}
                            onClick={() => handleLockToggle(index)}
                            disabled={uploading || directoryUploading}
                          >
                            {file.locked ? "Unlock" : "Lock"}
                          </button>
                        )}
                      </td>
                    </tr>

                    {/* Version Details Row - Shows ALL versions with download buttons */}
                    {!file.isFolder && isVersionExpanded && (
                      <tr className="version-details-row">
                        <td colSpan="8">
                          <div className="version-details-container">
                            <div className="version-header">
                              <h4>All Versions for {file.fileName}</h4>
                              <span
                                onClick={() => handleVersionToggle(fileName)}
                                style={{
                                  cursor: "pointer",
                                  color: "#1890ff",
                                  fontSize: "12px",
                                  fontWeight: "bold",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "4px",
                                }}
                              >
                                Hide versions
                                <span style={{ fontSize: "10px" }}>▲</span>
                              </span>
                            </div>
                            <div className="versions-list">
                              {file.versions && file.versions.length > 0 ? (
                                file.versions.map((version, vIndex) => {
                                  const versionDownloadKey = `${fileName}-${version.VersionId}`;
                                  const isVersionDownloading =
                                    downloadingFiles.has(versionDownloadKey);

                                  return (
                                    <div
                                      key={version.VersionId || vIndex}
                                      className={`version-item ${
                                        version.IsLatest ? "latest-version" : ""
                                      }`}
                                    >
                                      <div className="version-info">
                                        <div className="version-details-grid">
                                          <div className="version-id">
                                            <strong>Version ID:</strong>{" "}
                                            {version.VersionId === "null"
                                              ? "Original"
                                              : version.VersionId}
                                            {version.IsLatest && (
                                              <span className="latest-badge">
                                                LATEST
                                              </span>
                                            )}
                                          </div>
                                          <div className="version-actions">
                                            <Tooltip
                                              title={`Download version ${
                                                version.VersionId === "null"
                                                  ? "Original"
                                                  : version.VersionId.substring(
                                                      0,
                                                      8
                                                    )
                                              }...`}
                                            >
                                              <button
                                                className="version-download-btn"
                                                onClick={() =>
                                                  handleVersionDownload(
                                                    fileName,
                                                    version
                                                  )
                                                }
                                                disabled={
                                                  isVersionDownloading ||
                                                  downloadingVersion
                                                }
                                                style={{
                                                  backgroundColor: "#52c41a",
                                                  color: "white",
                                                  border: "none",
                                                  borderRadius: "6px",
                                                  padding: "6px 12px",
                                                  cursor: isVersionDownloading
                                                    ? "not-allowed"
                                                    : "pointer",
                                                  fontSize: "12px",
                                                  display: "flex",
                                                  alignItems: "center",
                                                  gap: "6px",
                                                  opacity: isVersionDownloading
                                                    ? 0.6
                                                    : 1,
                                                  transition: "all 0.2s ease",
                                                  fontWeight: "500",
                                                }}
                                                onMouseOver={(e) => {
                                                  if (!isVersionDownloading) {
                                                    e.target.style.backgroundColor =
                                                      "#73d13d";
                                                    e.target.style.transform =
                                                      "translateY(-1px)";
                                                  }
                                                }}
                                                onMouseOut={(e) => {
                                                  if (!isVersionDownloading) {
                                                    e.target.style.backgroundColor =
                                                      "#52c41a";
                                                    e.target.style.transform =
                                                      "translateY(0)";
                                                  }
                                                }}
                                              >
                                                {isVersionDownloading ? (
                                                  <>
                                                    <span
                                                      className="spinner"
                                                      style={{
                                                        width: "12px",
                                                        height: "12px",
                                                        border:
                                                          "2px solid #fff",
                                                        borderTop:
                                                          "2px solid transparent",
                                                        borderRadius: "50%",
                                                        animation:
                                                          "spin 1s linear infinite",
                                                      }}
                                                    ></span>
                                                    Downloading...
                                                  </>
                                                ) : (
                                                  <>📥 Download</>
                                                )}
                                              </button>
                                            </Tooltip>
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  );
                                })
                              ) : (
                                <div className="no-versions">
                                  No version information available
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>

          {/* Enhanced Pagination */}
          <div className="pagination-container">
            <Pagination
              current={currentPage}
              pageSize={pageSize}
              total={displayFiles.length}
              onChange={(page, newSize) => {
                setCurrentPage(page);
                setPageSize(newSize);
              }}
              showSizeChanger
              pageSizeOptions={["10", "20", "50", "100"]}
              showQuickJumper
              showTotal={(total, range) =>
                `${range[0]}-${range[1]} of ${total} ${
                  isSearchMode ? "search results" : "items"
                }`
              }
              className="custom-pagination"
            />
          </div>
        </>
      )}
    </div>
  );
};

export default FileList;
