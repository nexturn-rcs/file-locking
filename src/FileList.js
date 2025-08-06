import React, { useState, useEffect, useRef } from "react";
import { Pagination, Modal, Radio, Button, Tooltip } from "antd";
import toast, { Toaster } from "react-hot-toast";
import "./FileList.css";
import { getUserFromToken } from "./auth";

const ITEMS_PER_PAGE = 8;
const API_BASE_URL = process.env.REACT_APP_FETCH_API_ENDPOINT;
console.log("API_BASE_URL", API_BASE_URL);

const FileList = () => {
  const [files, setFiles] = useState([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [pageSize, setPageSize] = useState(10);
  const [expandedFolders, setExpandedFolders] = useState(new Set());
  const [downloadingFiles, setDownloadingFiles] = useState(new Set()); // Track downloading files
  const [expandedVersions, setExpandedVersions] = useState(new Set()); // Track expanded version details

  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [uploadType, setUploadType] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  // New state for directory upload
  const [directoryUploadModalVisible, setDirectoryUploadModalVisible] =
    useState(false);
  const [targetDirectory, setTargetDirectory] = useState("");
  const [directorySelectedFiles, setDirectorySelectedFiles] = useState([]);
  const [directoryUploading, setDirectoryUploading] = useState(false);

  // New state for version download modal
  const [versionDownloadModalVisible, setVersionDownloadModalVisible] = useState(false);
  const [selectedVersion, setSelectedVersion] = useState(null);
  const [downloadingVersion, setDownloadingVersion] = useState(false);

  const fileInputRef = useRef();
  const folderInputRef = useRef();
  const directoryFileInputRef = useRef();

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

  // Helper function to organize files into folder structure (with nested folder support)
  const organizeFiles = (fileList) => {
    const organized = [];
    const folderMap = {};

    // Recursive function to organize nested structure
    const organizeNested = (items, currentMap, parentPath = "") => {
      items.forEach((file) => {
        const { fileName, locked, lockedBy, timestamp } = file;

        // Check if this is a file within a folder (has forward slash)
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

          // If there are more path segments, it's either a nested folder or file in nested folder
          if (subPath.includes("/")) {
            // It's a nested structure, recursively organize
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
            // It's a direct file in this folder
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
          // Regular file (not in a folder)
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

    // Start the organization process
    organizeNested(fileList, folderMap);

    // Convert childrenMap to children array for nested folders
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
      delete folderObj.childrenMap; // Clean up the temporary map
    };

    // Process all folders to convert nested maps to arrays
    Object.values(folderMap).forEach((folder) => {
      processNestedFolders(folder);
      organized.push(folder);
    });

    return organized;
  };

  // Helper function to flatten organized files for display with expansion (with nested folder support)
  const flattenForDisplay = (organizedFiles, level = 0) => {
    const flattened = [];

    organizedFiles.forEach((item) => {
      // Add the current item with its nesting level
      flattened.push({
        ...item,
        nestingLevel: level,
      });

      const folderKey = item.fullPath || item.fileName;
      if (item.isFolder && expandedFolders.has(folderKey)) {
        item.children.forEach((child) => {
          if (child.isFolder) {
            // Recursively flatten nested folders
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
            // Regular file in folder
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

  // ✅ New function to handle version toggle
  const handleVersionToggle = (fileName) => {
    const newExpandedVersions = new Set(expandedVersions);
    if (newExpandedVersions.has(fileName)) {
      newExpandedVersions.delete(fileName);
    } else {
      newExpandedVersions.add(fileName);
    }
    setExpandedVersions(newExpandedVersions);
  };

  // ✅ New function to handle version download modal
  const handleVersionDownload = (fileName, version) => {
    setSelectedVersion({
      fileName,
      version,
      displayName: fileName.includes("/") ? fileName.split("/").pop() : fileName
    });
    setVersionDownloadModalVisible(true);
  };

  // ✅ New function to confirm and download specific version
  const confirmVersionDownload = async () => {
    if (!selectedVersion) return;

    const { fileName, version, displayName } = selectedVersion;
    const downloadKey = `${fileName}-${version.VersionId}`;

    // Add to downloading state
    setDownloadingVersion(true);
    setDownloadingFiles((prev) => new Set(prev).add(downloadKey));

    try {
      // Create request payload for version download
      const requestBody = {
        filename: fileName
      };

      // Add version ID if it's not null (null means original version)
      if (version.VersionId && version.VersionId !== "null") {
        requestBody.versionId = version.VersionId;
      }

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

      // Get the blob data
      const blob = await response.blob();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      // Create filename with version info
      const fileExtension = displayName.includes('.') ? displayName.split('.').pop() : '';
      const fileNameWithoutExt = displayName.includes('.') ? displayName.substring(0, displayName.lastIndexOf('.')) : displayName;
      const versionLabel = version.IsLatest ? 'latest' : (version.VersionId === "null" ? 'original' : version.VersionId.substring(0, 8));
      const downloadFileName = fileExtension 
        ? `${fileNameWithoutExt}_v${versionLabel}.${fileExtension}`
        : `${fileNameWithoutExt}_v${versionLabel}`;

      link.download = downloadFileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(`Version downloaded successfully as "${downloadFileName}"!`);
      
      // Close modal
      setVersionDownloadModalVisible(false);
      setSelectedVersion(null);

    } catch (error) {
      console.error("Version download error:", error);
      toast.error(`Failed to download version: ${error.message}`);
    } finally {
      // Remove from downloading state
      setDownloadingVersion(false);
      setDownloadingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(downloadKey);
        return newSet;
      });
    }
  };

  // ✅ Function to handle file download (latest version)
  const handleDownload = async (file) => {
    const fileName = file.fullPath || file.fileName;

    if (file.isFolder) {
      toast.error(
        "Cannot download folders directly. Please download individual files."
      );
      return;
    }

    // Add file to downloading state
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

      // Get the blob data
      const blob = await response.blob();

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;

      // Extract just the filename for download (remove folder path)
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
      // Remove file from downloading state
      setDownloadingFiles((prev) => {
        const newSet = new Set(prev);
        newSet.delete(fileName);
        return newSet;
      });
    }
  };

  // ✅ Fetch files from S3 and DynamoDB
  const fetchFiles = async () => {
    setLoading(true);
    try {
      const [s3Res, lockRes] = await Promise.all([
        fetch(`${API_BASE_URL}/s3-files`).then((r) => r.json()),
        fetch(`${API_BASE_URL}/list`).then((r) => r.json()),
      ]);

      const lockMap = {};
      lockRes.forEach((item) => {
        lockMap[item.filename] = {
          locked: item.status === "locked",
          lockedBy: item.locked_by || null,
          timestamp: item.timestamp || null,
        };
      });

      const merged = s3Res.map((fileName) => ({
        fileName,
        locked: lockMap[fileName]?.locked || false,
        lockedBy: lockMap[fileName]?.lockedBy || null,
        timestamp: lockMap[fileName]?.timestamp || null,
      }));

      const organized = organizeFiles(merged);

      const withVersions = await Promise.all(
        organized.map(async (f) => {
          if (!f.isFolder) {
            f.versions = await fetchFileVersions(f.fileName);
          }
          return f;
        })
      );

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
  }, []);

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
    const flattenedFiles = flattenForDisplay(files);
    const index = (currentPage - 1) * pageSize + indexOnPage;
    const file = flattenedFiles[index];

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
      const isCurrentlyLocked = file.locked; // Store the current state

      const payload = file.locked
        ? { filename: fileName }
        : { filename: fileName, user: user.email };

      const response = await fetch(`${API_BASE_URL}/${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (response.ok) {
        // Update the file in the organized structure
        const updatedFiles = [...files];

        if (file.isChild) {
          // Find the parent folder and update the child
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
          // Regular file
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

        // Fix: Use the stored current state to show correct message
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

    if (uploadType === "file" && fileInputRef.current)
      fileInputRef.current.value = "";
    if (uploadType === "folder" && folderInputRef.current)
      folderInputRef.current.value = "";
  };

  const resetUploadState = () => {
    setSelectedFiles([]);
    setUploadType(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (folderInputRef.current) folderInputRef.current.value = "";
  };

  // New function to handle directory upload
  const handleDirectoryUpload = (folderName, folderFullPath) => {
    setTargetDirectory(folderFullPath || folderName);
    setDirectoryUploadModalVisible(true);
  };

  const handleDirectoryFileChange = (e) => {
    const files = Array.from(e.target.files);
    setDirectorySelectedFiles(files);
  };

  const resetDirectoryUploadState = () => {
    setDirectorySelectedFiles([]);
    setTargetDirectory("");
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
      console.log("Starting directory upload process...");

      const filesPayload = await Promise.all(
        directorySelectedFiles.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const base64Content = reader.result.split(",")[1];
                // Prepend the target directory to the file path
                const fileKey = `${targetDirectory}/${file.name}`;
                resolve({
                  key: fileKey,
                  content_base64: base64Content,
                  content_type: file.type || "application/octet-stream",
                });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );

      console.log("Files prepared for directory upload, sending to server...");

      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: filesPayload }),
      });

      const result = await response.json();
      console.log("Directory upload response:", response.status, result);

      toast.dismiss(loadingToast);

      if (response.ok && result.uploaded && result.uploaded.length > 0) {
        console.log("Directory upload successful, showing success message...");

        toast.success(
          `🎉 Successfully uploaded ${result.uploaded.length} file(s) to ${targetDirectory}!`,
          {
            duration: 4000,
            position: "top-center",
            style: {
              background: "#10B981",
              color: "white",
              fontWeight: "600",
              padding: "16px",
              borderRadius: "12px",
              fontSize: "14px",
            },
            iconTheme: {
              primary: "white",
              secondary: "#10B981",
            },
          }
        );

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
        console.warn("Directory upload failed:", result);
        toast.error(result.message || "Upload failed or no files uploaded");
      }
    } catch (err) {
      console.error("Directory upload error:", err);
      toast.dismiss(loadingToast);
      toast.error("Upload failed. Please try again.");
    } finally {
      setDirectoryUploading(false);
      console.log("Directory upload process completed");
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
      console.log("Starting upload process...");

      const filesPayload = await Promise.all(
        selectedFiles.map(
          (file) =>
            new Promise((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => {
                const base64Content = reader.result.split(",")[1];
                resolve({
                  key: file.webkitRelativePath || file.name,
                  content_base64: base64Content,
                  content_type: file.type || "application/octet-stream",
                });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            })
        )
      );

      console.log("Files prepared, sending to server...");

      const response = await fetch(`${API_BASE_URL}/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: filesPayload }),
      });

      const result = await response.json();
      console.log("Upload response:", response.status, result);

      toast.dismiss(loadingToast);

      if (response.ok && result.uploaded && result.uploaded.length > 0) {
        console.log("Upload successful, showing success message...");

        toast.success(
          `🎉 Successfully uploaded ${result.uploaded.length} file(s)!`,
          {
            duration: 4000,
            position: "top-center",
            style: {
              background: "#10B981",
              color: "white",
              fontWeight: "600",
              padding: "16px",
              borderRadius: "12px",
              fontSize: "14px",
            },
            iconTheme: {
              primary: "white",
              secondary: "#10B981",
            },
          }
        );

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
        console.warn("Upload failed:", result);
        toast.error(result.message || "Upload failed or no files uploaded");
      }
    } catch (err) {
      console.error("Upload error:", err);
      toast.dismiss(loadingToast);
      toast.error("Upload failed. Please try again.");
    } finally {
      setUploading(false);
      console.log("Upload process completed");
    }
  };

  const flattenedFiles = flattenForDisplay(files);
  const startIndex = (currentPage - 1) * pageSize;
  const paginatedFiles = flattenedFiles.slice(
    startIndex,
    startIndex + pageSize
  );

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

  const formatFileSize = (bytes) => {
    if (!bytes) return "-";
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    
    return `${size.toFixed(1)} ${units[unitIndex]}`;
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
            boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
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
            <h1 className="main-title">S3 File Manager</h1>
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

      {/* Enhanced Upload Button */}
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
          <div className="selected-files">
            <h4 className="selected-files-title">
              <span className="files-count">{selectedFiles.length}</span> file(s) selected:
            </h4>
            <div className="file-list">
              {selectedFiles.slice(0, 10).map((file, index) => (
                <div key={index} className="file-item">
                  <span className="file-icon">📄</span>
                  <span className="file-name">{file.webkitRelativePath || file.name}</span>
                </div>
              ))}
              {selectedFiles.length > 10 && (
                <div className="file-item more-files">
                  <span className="file-icon">⋯</span>
                  <span className="file-name">and {selectedFiles.length - 10} more files</span>
                </div>
              )}
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
            Upload to Directory: <span className="directory-name">{targetDirectory}</span>
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
          <p className="instruction">Select files to upload to this directory</p>
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
          <div className="selected-files directory-files">
            <h4 className="selected-files-title">
              <span className="files-count">{directorySelectedFiles.length}</span> file(s) selected for {targetDirectory}:
            </h4>
            <div className="file-list">
              {directorySelectedFiles.slice(0, 10).map((file, index) => (
                <div key={index} className="file-item">
                  <span className="file-icon">📄</span>
                  <span className="file-name">{targetDirectory}/{file.name}</span>
                </div>
              ))}
              {directorySelectedFiles.length > 10 && (
                <div className="file-item more-files">
                  <span className="file-icon">⋯</span>
                  <span className="file-name">and {directorySelectedFiles.length - 10} more files</span>
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* NEW: Version Download Confirmation Modal */}
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
                <p>Are you sure you want to download this version of the file?</p>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Original Loading State */}
      {loading ? (
        <div className="custom-loader">
          <div className="spinner"></div>
          <div className="loader-text">Please Wait...</div>
        </div>
      ) : files.length === 0 ? (
        <div className="no-files-message">No files found</div>
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
                    <tr className={file.isChild ? "child-file" : ""}>
                      <td
                        style={{
                          paddingLeft: file.isChild
                            ? `${(file.nestingLevel || 1) * 30}px`
                            : "10px",
                        }}
                      >
                        {file.isFolder ? (
                          <span style={{ display: "flex", alignItems: "center" }}>
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
                                handleFolderToggle(file.fullPath || file.fileName)
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
                              {expandedFolders.has(file.fullPath || file.fileName)
                                ? "▲"
                                : "▼"}
                            </span>
                          </span>
                        ) : (
                          <span style={{ display: "flex", alignItems: "center" }}>
                            {!file.isChild && (
                              <span style={{ marginRight: "8px" }}>📄</span>
                            )}
                            {file.isChild && (
                              <span style={{ marginRight: "8px" }}>📄</span>
                            )}
                            {file.fileName}
                          </span>
                        )}
                      </td>
                      <td>{file.isFolder ? "-" : file.locked ? "Yes" : "No"}</td>
                      <td>
                        {file.isFolder ? (
                          "-"
                        ) : file.locked ? (
                          <Tooltip title={file.lockedBy}>{file.lockedBy}</Tooltip>
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
                          <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                            <span
                              onClick={() => handleVersionToggle(fileName)}
                              style={{
                                color: "#1890ff",
                                cursor: "pointer",
                                textDecoration: "underline",
                                fontSize: "12px",
                                fontWeight: "500",
                                display: "flex",
                                alignItems: "center",
                                gap: "4px",
                              }}
                            >
                              Click here to see version
                              <span
                                style={{
                                  fontSize: "10px",
                                  fontWeight: "bold",
                                  transition: "transform 0.2s ease",
                                  transform: isVersionExpanded ? "rotate(180deg)" : "rotate(0deg)",
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
                              const latest = file.versions?.find((v) => v.IsLatest);
                              return latest?.LastModified
                                ? formatDateTime(latest.LastModified)
                                : "-";
                            })()}
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
                                  uploading || directoryUploading || isDownloading
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
                    
                    {/* Version Details Row - Now shows ALL versions with download buttons */}
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
                                  const isVersionDownloading = downloadingFiles.has(versionDownloadKey);
                                  
                                  return (
                                    <div 
                                      key={version.VersionId || vIndex} 
                                      className={`version-item ${version.IsLatest ? 'latest-version' : ''}`}
                                    >
                                      <div className="version-info">
                                        <div className="version-details-grid">
                                          <div className="version-id">
                                            <strong>Version ID:</strong>{" "}
                                            {version.VersionId === "null"
                                              ? "Original"
                                              : version.VersionId}
                                            {version.IsLatest && (
                                              <span className="latest-badge">LATEST</span>
                                            )}
                                          </div>
                                          <div className="version-actions">
                                            <Tooltip title={`Download version ${version.VersionId === "null" ? "Original" : version.VersionId.substring(0, 8)}...`}>
                                              <button
                                                className="version-download-btn"
                                                onClick={() => handleVersionDownload(fileName, version)}
                                                disabled={isVersionDownloading || downloadingVersion}
                                                style={{
                                                  backgroundColor: "#52c41a",
                                                  color: "white",
                                                  border: "none",
                                                  borderRadius: "6px",
                                                  padding: "6px 12px",
                                                  cursor: isVersionDownloading ? "not-allowed" : "pointer",
                                                  fontSize: "12px",
                                                  display: "flex",
                                                  alignItems: "center",
                                                  gap: "6px",
                                                  opacity: isVersionDownloading ? 0.6 : 1,
                                                  transition: "all 0.2s ease",
                                                  fontWeight: "500",
                                                }}
                                                onMouseOver={(e) => {
                                                  if (!isVersionDownloading) {
                                                    e.target.style.backgroundColor = "#73d13d";
                                                    e.target.style.transform = "translateY(-1px)";
                                                  }
                                                }}
                                                onMouseOut={(e) => {
                                                  if (!isVersionDownloading) {
                                                    e.target.style.backgroundColor = "#52c41a";
                                                    e.target.style.transform = "translateY(0)";
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
                                                        border: "2px solid #fff",
                                                        borderTop: "2px solid transparent",
                                                        borderRadius: "50%",
                                                        animation: "spin 1s linear infinite",
                                                      }}
                                                    ></span>
                                                    Downloading...
                                                  </>
                                                ) : (
                                                  <>
                                                    📥 Download
                                                  </>
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
              total={flattenedFiles.length}
              onChange={(page, newSize) => {
                setCurrentPage(page);
                setPageSize(newSize);
              }}
              showSizeChanger
              pageSizeOptions={["10", "20", "50", "100"]}
              showQuickJumper
              showTotal={(total, range) =>
                `${range[0]}-${range[1]} of ${total} items`
              }
              className="custom-pagination"
            />
          </div>

          {/* Add CSS for spinner animation and enhanced version details */}
          <style jsx>{`
            @keyframes spin {
              0% {
                transform: rotate(0deg);
              }
              100% {
                transform: rotate(360deg);
              }
            }
            
            .version-details-row {
              background-color: #f8f9fa !important;
              border-top: 2px solid #e9ecef;
            }
            
            .version-details-container {
              padding: 20px;
              background: linear-gradient(135deg, #f8f9fa 0%, #e9ecef 100%);
              border-radius: 8px;
              margin: 10px;
              box-shadow: inset 0 2px 4px rgba(0,0,0,0.1);
            }
            
            .version-header {
              display: flex;
              justify-content: space-between;
              align-items: center;
              margin-bottom: 15px;
              padding-bottom: 10px;
              border-bottom: 2px solid #dee2e6;
            }
            
            .version-header h4 {
              margin: 0;
              color: #495057;
              font-size: 16px;
              font-weight: 600;
            }
            
            .versions-list {
              max-height: 500px;
              overflow-y: auto;
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            
            .version-item {
              background: white;
              border: 1px solid #dee2e6;
              border-radius: 8px;
              padding: 15px;
              box-shadow: 0 2px 4px rgba(0,0,0,0.05);
              transition: all 0.2s ease;
            }
            
            .version-item:hover {
              box-shadow: 0 4px 8px rgba(0,0,0,0.1);
              transform: translateY(-1px);
            }
            
            .latest-version {
              border-color: #28a745;
              background: linear-gradient(135deg, #d4edda 0%, #c3e6cb 100%);
            }
            
            .version-info {
              width: 100%;
            }
            
            .version-details-grid {
              display: grid;
              grid-template-columns: 1fr 1fr 1fr auto;
              gap: 12px;
              align-items: center;
            }
            
            .version-id, .version-date, .version-size {
              font-family: 'Monaco', 'Menlo', monospace;
              font-size: 12px;
              word-break: break-all;
              color: #495057;
            }
            
            .version-id {
              font-size: 13px;
              font-weight: 600;
            }
            
            .version-actions {
              display: flex;
              justify-content: flex-end;
              align-items: center;
            }
            
            .latest-badge {
              background: #28a745;
              color: white;
              padding: 2px 8px;
              border-radius: 12px;
              font-size: 9px;
              font-weight: bold;
              text-transform: uppercase;
              letter-spacing: 0.5px;
              margin-left: 8px;
            }
            
            .no-versions {
              text-align: center;
              color: #6c757d;
              font-style: italic;
              padding: 20px;
              background: white;
              border-radius: 8px;
              border: 1px dashed #dee2e6;
            }

            /* Version Download Modal Styles */
            .version-download-modal .ant-modal-content {
              border-radius: 16px;
            }
            
            .version-download-content {
              padding: 20px 0;
            }
            
            .download-info {
              display: flex;
              flex-direction: column;
              gap: 20px;
            }
            
            .file-info {
              background: #f8f9fa;
              border-radius: 12px;
              padding: 20px;
              border: 1px solid #e9ecef;
            }
            
            .file-name-title {
              display: flex;
              align-items: center;
              margin: 0 0 15px 0;
              font-size: 18px;
              font-weight: 600;
              color: #495057;
            }
            
            .file-name-title .file-icon {
              margin-right: 12px;
              font-size: 20px;
            }
            
            .version-details {
              display: flex;
              flex-direction: column;
              gap: 12px;
            }
            
            .detail-item {
              display: flex;
              align-items: center;
              gap: 8px;
              padding: 8px 0;
              border-bottom: 1px solid #e9ecef;
            }
            
            .detail-item:last-child {
              border-bottom: none;
            }
            
            .detail-label {
              font-weight: 600;
              color: #6c757d;
              min-width: 120px;
            }
            
            .detail-value {
              color: #495057;
              font-family: 'Monaco', 'Menlo', monospace;
              font-size: 13px;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            
            .confirmation-message {
              text-align: center;
              padding: 20px;
              background: #fff3cd;
              border: 1px solid #ffeaa7;
              border-radius: 8px;
              color: #856404;
            }
            
            .confirmation-message p {
              margin: 0;
              font-weight: 500;
            }
            
            .download-confirm-button {
              background: linear-gradient(135deg, #28a745 0%, #20c997 100%);
              border: none;
              border-radius: 8px;
              font-weight: 600;
            }
            
            @media (max-width: 768px) {
              .version-details-grid {
                grid-template-columns: 1fr;
                gap: 8px;
              }
              
              .version-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 10px;
              }
              
              .version-actions {
                justify-content: center;
                margin-top: 10px;
              }
            }
          `}</style>
        </>
      )}

      {/* Enhanced CSS Styles with Larger Logo */}
      <style jsx>{`
        .file-container {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          min-height: 100vh;
          padding: 20px;
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
        }

        .header-container {
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(20px);
          border-radius: 20px;
          padding: 40px 48px;
          margin-bottom: 32px;
          box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.2);
        }

        .header-content {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 32px;
        }

        .title-section {
          flex: 1;
        }

        .main-title {
          font-size: 2.5rem;
          font-weight: 700;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
          background-clip: text;
          margin: 0;
          letter-spacing: -0.025em;
        }

        .subtitle {
          font-size: 1.125rem;
          color: #6B7280;
          margin: 8px 0 0 0;
          font-weight: 500;
        }

        .logo-section {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .company-logo {
          max-width: 280px;
          max-height: 120px;
          width: auto;
          height: auto;
          object-fit: contain;
          border-radius: 16px;
          box-shadow: 0 8px 12px -2px rgba(0, 0, 0, 0.15);
          transition: transform 0.3s ease, box-shadow 0.3s ease;
        }

        .company-logo:hover {
          transform: scale(1.02);
          box-shadow: 0 12px 20px -4px rgba(0, 0, 0, 0.2);
        }

        .upload-section {
          text-align: center;
          margin-bottom: 32px;
        }

        .upload-button {
          background: linear-gradient(135deg, #10B981 0%, #059669 100%);
          border: none;
          border-radius: 16px;
          padding: 16px 32px;
          font-size: 16px;
          font-weight: 600;
          height: auto;
          box-shadow: 0 10px 15px -3px rgba(16, 185, 129, 0.3);
          transition: all 0.3s ease;
        }

        .upload-button:hover {
          transform: translateY(-2px);
          box-shadow: 0 20px 25px -5px rgba(16, 185, 129, 0.4);
        }

        .custom-modal .ant-modal-content {
          border-radius: 20px;
          overflow: hidden;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
        }

        .modal-title {
          display: flex;
          align-items: center;
          font-size: 1.25rem;
          font-weight: 600;
          color: #1F2937;
        }

        .modal-icon {
          margin-right: 12px;
          font-size: 1.5rem;
        }

        .directory-name {
          color: #10B981;
          font-weight: 700;
        }

        .upload-options {
          margin: 24px 0;
        }

        .radio-group {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .radio-option {
          padding: 16px;
          border: 2px solid #E5E7EB;
          border-radius: 12px;
          transition: all 0.3s ease;
        }

        .radio-option:hover {
          border-color: #10B981;
          background: #F0FDF4;
        }

        .radio-label {
          display: flex;
          align-items: center;
          font-weight: 500;
          color: #374151;
        }

        .radio-icon {
          margin-right: 12px;
          font-size: 1.25rem;
        }

        .selected-files {
          margin-top: 24px;
          padding: 20px;
          background: #F8FAFC;
          border-radius: 12px;
          border: 1px solid #E2E8F0;
        }

        .selected-files-title {
          margin: 0 0 16px 0;
          font-size: 1rem;
          font-weight: 600;
          color: #1E293B;
        }

        .files-count {
          background: #10B981;
          color: white;
          padding: 4px 8px;
          border-radius: 6px;
          font-size: 0.875rem;
          font-weight: 700;
        }

        .file-list {
          max-height: 200px;
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .file-item {
          display: flex;
          align-items: center;
          padding: 8px 12px;
          background: white;
          border-radius: 8px;
          border: 1px solid #E2E8F0;
        }

        .file-icon {
          margin-right: 8px;
          font-size: 1rem;
        }

        .file-name {
          color: #475569;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .more-files {
          background: #F1F5F9;
          font-style: italic;
        }

        .directory-upload-content {
          margin: 20px 0;
        }

        .target-directory {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 12px;
          padding: 12px;
          background: #EFF6FF;
          border-radius: 8px;
          border: 1px solid #DBEAFE;
        }

        .label {
          font-weight: 600;
          color: #1E40AF;
        }

        .directory-path {
          font-family: 'JetBrains Mono', monospace;
          background: #3B82F6;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 0.875rem;
          font-weight: 500;
        }

        .instruction {
          color: #6B7280;
          margin: 0;
          font-size: 0.875rem;
        }

        .directory-files {
          background: #F0F9FF;
          border-color: #BAE6FD;
        }

        .cancel-button {
          border-radius: 8px;
          border: 1px solid #D1D5DB;
          color: #6B7280;
          font-weight: 500;
        }

        .select-files-button {
          background: #F3F4F6;
          border: 1px solid #D1D5DB;
          border-radius: 8px;
          color: #374151;
          font-weight: 500;
        }

        .upload-modal-button {
          background: linear-gradient(135deg, #10B981 0%, #059669 100%);
          border: none;
          border-radius: 8px;
          font-weight: 600;
        }

        .pagination-container {
          display: flex;
          justify-content: center;
          background: rgba(255, 255, 255, 0.95);
          backdrop-filter: blur(20px);
          border-radius: 16px;
          padding: 24px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
          margin-top: 20px;
        }

        .custom-pagination .ant-pagination-item {
          border-radius: 8px;
          border: 1px solid #E5E7EB;
        }

        .custom-pagination .ant-pagination-item-active {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          border-color: #667eea;
        }

        .custom-pagination .ant-pagination-item-active a {
          color: white;
        }

        .custom-pagination .ant-pagination-options-quick-jumper input {
          border-radius: 6px;
          border: 1px solid #D1D5DB;
        }

        .custom-pagination .ant-select-selector {
          border-radius: 6px;
          border: 1px solid #D1D5DB;
        }

        @keyframes spin {
          0% {
            transform: rotate(0deg);
          }
          100% {
            transform: rotate(360deg);
          }
        }

        @media (max-width: 768px) {
          .file-container {
            padding: 12px;
          }
          
          .header-container {
            padding: 24px 20px;
          }
          
          .header-content {
            flex-direction: column;
            gap: 24px;
            text-align: center;
          }
          
          .main-title {
            font-size: 2rem;
          }

          .company-logo {
            max-width: 240px;
            max-height: 100px;
          }
        }

        @media (max-width: 480px) {
          .header-container {
            padding: 20px 16px;
          }
          
          .main-title {
            font-size: 1.75rem;
          }

          .company-logo {
            max-width: 200px;
            max-height: 80px;
          }
        }
      `}</style>
    </div>
  );
};

export default FileList;