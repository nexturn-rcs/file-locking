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

  const [uploadModalVisible, setUploadModalVisible] = useState(false);
  const [uploadType, setUploadType] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploading, setUploading] = useState(false);

  const fileInputRef = useRef();
  const folderInputRef = useRef();

  // Helper function to organize files into folder structure
  const organizeFiles = (fileList) => {
    const organized = [];
    const folderMap = {};

    fileList.forEach((file) => {
      const { fileName, locked, lockedBy, timestamp } = file;

      // Check if this is a file within a folder (has forward slash)
      if (fileName.includes("/")) {
        const parts = fileName.split("/");
        const folderName = parts[0];
        const subPath = parts.slice(1).join("/");

        if (!folderMap[folderName]) {
          folderMap[folderName] = {
            fileName: folderName,
            isFolder: true,
            locked: false,
            lockedBy: null,
            timestamp: null,
            children: [],
          };
        }

        folderMap[folderName].children.push({
          fileName: subPath,
          fullPath: fileName,
          locked,
          lockedBy,
          timestamp,
          isFolder: false,
        });
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

    // Add folders to organized list
    Object.values(folderMap).forEach((folder) => {
      organized.push(folder);
    });

    return organized;
  };

  // Helper function to flatten organized files for display with expansion
  const flattenForDisplay = (organizedFiles) => {
    const flattened = [];

    organizedFiles.forEach((item) => {
      flattened.push(item);

      if (item.isFolder && expandedFolders.has(item.fileName)) {
        item.children.forEach((child) => {
          flattened.push({
            ...child,
            isChild: true,
            parentFolder: item.fileName,
          });
        });
      }
    });

    return flattened;
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
      setFiles(organized);
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

  const handleFolderToggle = (folderName) => {
    const newExpandedFolders = new Set(expandedFolders);
    if (newExpandedFolders.has(folderName)) {
      newExpandedFolders.delete(folderName);
    } else {
      newExpandedFolders.add(folderName);
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
              background: "#4CAF50",
              color: "white",
              fontWeight: "bold",
              padding: "16px",
              borderRadius: "8px",
            },
            iconTheme: {
              primary: "white",
              secondary: "#4CAF50",
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
            background: "#363636",
            color: "#fff",
          },
          success: {
            duration: 4000,
            theme: {
              primary: "green",
              secondary: "black",
            },
          },
          error: {
            duration: 4000,
            theme: {
              primary: "red",
              secondary: "black",
            },
          },
        }}
      />

      <div
        style={{
          position: "relative",
          textAlign: "center",
          marginBottom: "20px",
          padding: "0 20px",
        }}
      >
        <div>
          <h1>S3 File Manager</h1>
          <h2>Files in S3 Bucket</h2>
        </div>

        <div
          style={{
            position: "absolute",
            top: "-10px",
            right: "-30px",
            display: "flex",
            alignItems: "center",
            height: "100%",
          }}
        >
          <img
            src="/DCLI_Logo.jpg"
            alt="TRAC Intermodal Logo"
            style={{
              maxWidth: "150px",
              maxHeight: "80px",
              objectFit: "contain",
            }}
          />
        </div>
      </div>

      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <Button
          type="primary"
          onClick={() => setUploadModalVisible(true)}
          loading={uploading}
          disabled={uploading}
        >
          {uploading ? "Processing..." : "Click here to choose files"}
        </Button>
      </div>

      <Modal
        open={uploadModalVisible}
        title="Upload Options"
        onCancel={() => {
          if (!uploading) {
            setUploadModalVisible(false);
            resetUploadState();
          }
        }}
        closable={!uploading}
        maskClosable={!uploading}
        footer={[
          <Button
            key="cancel"
            onClick={() => {
              setUploadModalVisible(false);
              resetUploadState();
            }}
            disabled={uploading}
          >
            Cancel
          </Button>,
          <Button
            key="upload"
            type="primary"
            onClick={handleUpload}
            disabled={selectedFiles.length === 0}
            loading={uploading}
          >
            {uploading ? "Uploading..." : "Upload"}
          </Button>,
        ]}
      >
        <Radio.Group
          onChange={handleUploadSelection}
          value={uploadType}
          disabled={uploading}
        >
          <Radio value="file">File Upload</Radio>
          <Radio value="folder">Folder Upload</Radio>
        </Radio.Group>

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
          <div
            style={{
              marginTop: 16,
              padding: 8,
              backgroundColor: "#f0f0f0",
              borderRadius: 4,
            }}
          >
            <p>
              <strong>{selectedFiles.length} file(s) selected:</strong>
            </p>
            <ul
              style={{
                maxHeight: 150,
                overflowY: "auto",
                margin: 0,
                paddingLeft: 20,
              }}
            >
              {selectedFiles.slice(0, 10).map((file, index) => (
                <li key={index}>{file.webkitRelativePath || file.name}</li>
              ))}
              {selectedFiles.length > 10 && (
                <li>... and {selectedFiles.length - 10} more files</li>
              )}
            </ul>
          </div>
        )}
      </Modal>

      {loading ? (
        <div className="custom-loader">
          <div className="spinner"></div>
          <div className="loader-text">Please Wait...</div>
        </div>
      ) : files.length === 0 ? (
        <div className="no-files-message">No files found</div>
      ) : (
        <>
          <table className="file-table">
            <thead>
              <tr>
                <th>File Name</th>
                <th>Locked</th>
                <th>Locked By</th>
                <th>Locked Date</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedFiles.map((file, index) => (
                <tr
                  key={file.fullPath || file.fileName}
                  className={file.isChild ? "child-file" : ""}
                >
                  <td style={{ paddingLeft: file.isChild ? "30px" : "10px" }}>
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
                          ({file.children.length} files)
                        </span>
                        <span
                          onClick={() => handleFolderToggle(file.fileName)}
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
                          {expandedFolders.has(file.fileName) ? "▲" : "▼"}
                        </span>
                      </span>
                    ) : (
                      <span style={{ display: "flex", alignItems: "center" }}>
                        {!file.isChild && (
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
                      <span style={{ color: "#999", fontStyle: "italic" }}>
                        -
                      </span>
                    ) : (
                      <button
                        className={file.locked ? "unlock-btn" : "lock-btn"}
                        onClick={() => handleLockToggle(index)}
                        disabled={uploading}
                      >
                        {file.locked ? "Unlock" : "Lock"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

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
            />
          </div>
        </>
      )}
    </div>
  );
};

export default FileList;
