// SPDX-License-Identifier: MIT
pragma solidity 0.8.18;

import {Proxied} from "./vendor/hardhat-deploy/Proxied.sol";
import {ILensHub} from "./vendor/lens/ILensHub.sol";
import {
    AddressUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/AddressUpgradeable.sol";
import {
    EnumerableSetUpgradeable
} from "@openzeppelin/contracts-upgradeable/utils/structs/EnumerableSetUpgradeable.sol";

struct Prompt {
    uint256 profileId;
    string prompt;
}

contract LensGelatoGPT is Proxied {
    using AddressUpgradeable for address payable;
    using EnumerableSetUpgradeable for EnumerableSetUpgradeable.UintSet;

    ILensHub public immutable lensHub;

    address public immutable dedicatedMsgSender;

    uint256 public fee;

    mapping(uint256 => string) public promptByProfileId;

    EnumerableSetUpgradeable.UintSet private _profileIds;

    modifier onlyProfileOwner(uint256 _profileId) {
        require(
            msg.sender == lensHub.ownerOf(_profileId),
            "LensGelatoGPT.onlyProfileOwner"
        );
        _;
    }

    modifier onlyDedicatedMsgSender() {
        require(
            msg.sender == dedicatedMsgSender,
            "LensGelatoGPT.onlyDedicatedMsgSender"
        );
        _;
    }

    constructor(ILensHub _lensHub, address _dedicatedMsgSender) {
        lensHub = _lensHub;
        dedicatedMsgSender = _dedicatedMsgSender;
    }

    function setFee(uint256 _fee) external onlyProxyAdmin {
        fee = _fee;
    }

    function collectFee(address payable _to) external onlyProxyAdmin {
        _to.sendValue(address(this).balance);
    }

    function setPrompt(
        uint256 _profileId,
        string calldata _prompt
    ) external payable onlyProfileOwner(_profileId) {
        require(msg.value == fee, "LensGelatoGPT.setPrompt: fee");
        require(
            bytes(_prompt).length <= 160,
            "LensGelatoGPT.setPrompt: length"
        );
        require(
            lensHub.getDispatcher(_profileId) == dedicatedMsgSender,
            "LensGelatoGPT.setPrompt: dispatcher"
        );
        _profileIds.add(_profileId);

        promptByProfileId[_profileId] = _prompt;
    }

    function stopPrompt(
        uint256 _profileId
    ) external onlyProfileOwner(_profileId) {
        require(
            _profileIds.contains(_profileId),
            "LensGelatoGPT.stopPrompt: 404"
        );
        _profileIds.remove(_profileId);
        delete promptByProfileId[_profileId];
    }

    function getPaginatedPrompts(
        uint256 _from,
        uint256 _to
    ) external view returns (Prompt[] memory prompts) {
        require(_from < _to, "LensGelatoGPT.getPaginatedPrompts: _to");
        require(
            _from <= _profileIds.length(),
            "LensGelatoGPT.getPaginatedPrompts: _from"
        );

        if (_to >= _profileIds.length()) _to = _profileIds.length();

        prompts = new Prompt[](_to - _from);

        for (uint256 i = _from; i < _to; i++) {
            uint256 profileId = _profileIds.at(i);

            // Filter out users with wrong Dispatcher on Lens
            if (lensHub.getDispatcher(profileId) != dedicatedMsgSender)
                continue;

            prompts[i - _from] = Prompt(
                profileId,
                promptByProfileId[profileId]
            );
        }
    }

    function getProfileIds() external view returns (uint256[] memory) {
        return _profileIds.values();
    }

    function getTotalNumberOfProfiles() external view returns (uint256) {
        return _profileIds.length();
    }
}
